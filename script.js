/* A small, dependency-free expression parser. No eval() or dynamic code execution. */
(function (root, factory) {
    const engine = factory();
    if (typeof module === 'object' && module.exports) module.exports = engine;
    root.CalculatorEngine = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    class CalculationError extends Error {
        constructor(message) {
            super(message);
            this.name = 'CalculationError';
        }
    }

    const functions = new Set(['sqrt', 'cbrt', 'log', 'ln', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'pow10', 'inv']);
    const degToRad = Math.PI / 180;

    function tokenize(expression) {
        if (typeof expression !== 'string' || !expression.trim()) throw new CalculationError('Enter a calculation.');
        if (expression.length > 200) throw new CalculationError('Expression is too long.');
        const source = expression.replace(/[×x]/g, '*').replace(/÷/g, '/').replace(/−/g, '-');
        const tokens = [];
        let i = 0;
        while (i < source.length) {
            const rest = source.slice(i);
            if (/^\s/.test(rest)) { i++; continue; }
            const number = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest);
            if (number) {
                const value = Number(number[0]);
                if (!Number.isFinite(value)) throw new CalculationError('Number is too large.');
                tokens.push({ type: 'number', value });
                i += number[0].length;
                continue;
            }
            if (rest[0] === 'π') { tokens.push({ type: 'constant', value: Math.PI }); i++; continue; }
            if (/^[a-zA-Z]/.test(rest)) {
                const match = /^[a-zA-Z]+(?:[0-9]+)?/.exec(rest);
                const word = match[0].toLowerCase();
                if (word === 'pi' || word === 'e') {
                    tokens.push({ type: 'constant', value: word === 'pi' ? Math.PI : Math.E });
                } else if (functions.has(word)) {
                    tokens.push({ type: 'function', value: word });
                } else {
                    throw new CalculationError('Unknown function or symbol: ' + word);
                }
                i += match[0].length;
                continue;
            }
            if ('+-*/^()%'.includes(rest[0])) { tokens.push({ type: rest[0] }); i++; continue; }
            throw new CalculationError('Invalid character: ' + rest[0]);
        }
        return tokens;
    }

    function applyFunction(name, number) {
        switch (name) {
            case 'sqrt': if (number < 0) throw new CalculationError('Square root needs a non-negative number.'); return Math.sqrt(number);
            case 'cbrt': return Math.cbrt(number);
            case 'log': if (number <= 0) throw new CalculationError('Log needs a positive number.'); return Math.log10(number);
            case 'ln': if (number <= 0) throw new CalculationError('Natural log needs a positive number.'); return Math.log(number);
            case 'pow10': return Math.pow(10, number);
            case 'inv': if (number === 0) throw new CalculationError('Cannot divide by zero.'); return 1 / number;
            case 'sin': { const result = Math.sin(number * degToRad); return Math.abs(result) < 1e-15 ? 0 : result; }
            case 'cos': { const result = Math.cos(number * degToRad); return Math.abs(result) < 1e-15 ? 0 : result; }
            case 'tan':
                if (Math.abs(Math.cos(number * degToRad)) < 1e-12) throw new CalculationError('Tangent is undefined for this angle.');
                return Math.tan(number * degToRad);
            case 'asin':
            case 'acos':
                if (number < -1 || number > 1) throw new CalculationError('Inverse sine/cosine needs a value from -1 to 1.');
                return (name === 'asin' ? Math.asin(number) : Math.acos(number)) / degToRad;
            case 'atan': return Math.atan(number) / degToRad;
            default: throw new CalculationError('Unsupported function.');
        }
    }

    function evaluate(expression) {
        const tokens = tokenize(expression);
        let position = 0;
        let depth = 0;
        function peek() { return tokens[position] || { type: 'end' }; }
        function take(type) { if (peek().type === type) { position++; return true; } return false; }
        function check(value) {
            if (!Number.isFinite(value)) throw new CalculationError('The result is undefined or too large.');
            return value;
        }
        function number(value, percent = false) { return { value: check(value), percent }; }
        function add() {
            let left = multiply();
            while (peek().type === '+' || peek().type === '-') {
                const op = tokens[position++].type;
                const right = multiply();
                // Calculator-style percent: 200 + 10% = 220; 200 * 10% = 20.
                const amount = right.percent ? left.value * right.value : right.value;
                left = number(op === '+' ? left.value + amount : left.value - amount);
            }
            return left;
        }
        function multiply() {
            let left = unary();
            while (true) {
                const op = peek().type;
                // Adjacent function, constant, or '(' implies multiplication: 2π, 3(4+5).
                const implicit = op === '(' || op === 'function' || op === 'constant';
                if (!implicit && op !== '*' && op !== '/') break;
                if (!implicit) position++;
                const right = unary();
                if (op === '/' && right.value === 0) throw new CalculationError('Cannot divide by zero.');
                left = number(op === '/' ? left.value / right.value : left.value * right.value);
            }
            return left;
        }
        function unary() {
            if (take('+')) return unary();
            if (take('-')) { const val = unary(); return number(-val.value, val.percent); }
            return power();
        }
        function power() {
            let left = postfix();
            if (take('^')) {
                const right = unary(); // right-associative: 2^3^2 = 512
                left = number(Math.pow(left.value, right.value));
            }
            return left;
        }
        function postfix() {
            let value = primary();
            while (take('%')) value = number(value.value / 100, true);
            return value;
        }
        function primary() {
            depth++;
            if (depth > 64) throw new CalculationError('Too many nested parentheses.');
            try {
                const token = peek();
                if (token.type === 'number' || token.type === 'constant') { position++; return number(token.value); }
                if (take('(')) {
                    const value = add();
                    // Unclosed opening parentheses are completed when '=' is pressed.
                    if (!take(')') && peek().type !== 'end') throw new CalculationError('Missing closing parenthesis.');
                    return value;
                }
                if (token.type === 'function') {
                    position++;
                    if (!take('(')) throw new CalculationError('Use parentheses after ' + token.value + '.');
                    const arg = add();
                    if (!take(')') && peek().type !== 'end') throw new CalculationError('Missing closing parenthesis.');
                    return number(applyFunction(token.value, arg.value));
                }
                throw new CalculationError('The expression is incomplete.');
            } finally { depth--; }
        }
        const result = add();
        if (peek().type !== 'end') throw new CalculationError('Unexpected symbol in expression.');
        return check(result.value);
    }

    function formatResult(value) {
        if (!Number.isFinite(value)) throw new CalculationError('The result is undefined.');
        const rounded = Number(value.toPrecision(12));
        return Object.is(rounded, -0) ? '0' : String(rounded);
    }

    return { evaluate, formatResult, CalculationError };
});


/* Calculator UI controller (combined with the engine in this standalone file). */
(function () {
    'use strict';
    const engine = globalThis.CalculatorEngine;
    const display = document.getElementById('display');
    const feedback = document.getElementById('feedback');
    const historyContainer = document.getElementById('historyLogContainer');
    const sidebar = document.getElementById('calcSidebar');
    const menuButton = document.getElementById('calcMenuBtn');
    const shiftButton = document.getElementById('shiftBtn');
    const storageKey = 'calculator-history-v1';
    let isShifted = false;
    let resultShown = false;
    let history = [];

    try {
        const parsed = JSON.parse(localStorage.getItem(storageKey) || '[]');
        if (Array.isArray(parsed)) {
            history = parsed.filter(item => item && typeof item.expression === 'string' && typeof item.result === 'string' && item.expression.length <= 200 && item.result.length <= 40)
                .slice(0, 50);
        }
    } catch (_) { /* The calculator also works with local storage blocked. */ }

    function message(text, isError = false) {
        feedback.textContent = text;
        feedback.classList.toggle('error', isError);
    }
    function current() { return display.value; }
    function update(value, completed = false) {
        display.value = value;
        resultShown = completed;
        
    }
    function prepareEntry() {
        if (current() === 'Error' || resultShown) update('');
    }
    function appendNumber(value) {
        prepareEntry();
        // Scientific notation from a result stays editable through the input itself.
        update(current() + (/[πe]$/.test(current()) ? '*' : '') + value);
    }
    function appendOperator(operator) {
        if (current() === 'Error') update('');
        const value = current();
        if (!value) { if (operator === '-') update('-'); return; }
        if (/[+*/^\-]$/.test(value)) {
            if (operator === '-' && !value.endsWith('-')) update(value + '-');
            else update(value.replace(/[+*/^\-]$/, operator));
        } else if (value.endsWith('(')) {
            if (operator === '-') update(value + '-');
        } else {
            update(value + operator);
        }
    }
    function appendDecimal() {
        prepareEntry();
        const value = current();
        const last = /(?:\d+(?:\.\d*)?|\.\d+)$/.exec(value);
        if (last && last[0].includes('.')) return;
        update(value + (last ? '.' : '0.'));
    }
    function appendPercentage() {
        if (current() && /[\dπe)]$/.test(current())) update(current() + '%');
    }
    function appendParenthesis(bracket) {
        prepareEntry();
        if (bracket === '(') { update(current() + '('); return; }
        const opens = (current().match(/\(/g) || []).length;
        const closes = (current().match(/\)/g) || []).length;
        if (opens > closes && /[\dπe)%]$/.test(current())) update(current() + ')');
    }
    function appendConstant(value) {
        prepareEntry();
        update(current() + value);
    }
    function appendScientific(type) {
        prepareEntry();
        const inverse = { sqrt: 'cbrt', log: 'pow10', sin: 'asin', cos: 'acos', tan: 'atan' };
        const name = isShifted ? (inverse[type] || type) : type;
        update(current() + name + '(');
        if (isShifted) toggleShift();
    }
    function toggleSign() {
        if (resultShown && current() !== 'Error') {
            update(current().startsWith('-') ? current().slice(1) : '-' + current(), true);
            return;
        }
        if (!current() || current() === 'Error') { update('-'); return; }
        const match = /(-?)(\d+(?:\.\d*)?|\.\d+)$/.exec(current());
        if (match) {
            const prefix = current().slice(0, match.index);
            const sign = match[1] === '-' && (!prefix || /[+*/^(\-]$/.test(prefix)) ? '' : '-';
            update(prefix + sign + match[2]);
        } else if (resultShown) update('-(' + current() + ')');
    }
    function clearDisplay() { update(''); }
    function deleteLast() { update(current() === 'Error' ? '' : current().slice(0, -1)); }
    function toggleShift() {
        isShifted = !isShifted;
        shiftButton.classList.toggle('shift-active', isShifted);
        shiftButton.setAttribute('aria-pressed', String(isShifted));
        const labels = isShifted
            ? { sqrtBtn: '∛', logBtn: '10ˣ', sinBtn: 'sin⁻¹', cosBtn: 'cos⁻¹', tanBtn: 'tan⁻¹' }
            : { sqrtBtn: '√', logBtn: 'log', sinBtn: 'sin', cosBtn: 'cos', tanBtn: 'tan' };
        for (const [id, label] of Object.entries(labels)) document.getElementById(id).textContent = label;
    }
    function calculate() {
        const expression = current().trim();
        if (!expression || expression === 'Error') return;
        try {
            const formatted = engine.formatResult(engine.evaluate(expression));
            history.unshift({ expression, result: formatted });
            history = history.slice(0, 50);
            saveHistory();
            renderHistory();
            update(formatted, true);
        } catch (error) {
            display.value = 'Error';
            resultShown = true;
            message(error instanceof engine.CalculationError ? error.message : 'Calculation failed.', true);
        }
    }
    function saveHistory() {
        try { localStorage.setItem(storageKey, JSON.stringify(history)); }
        catch (_) { /* Private browsing or quota restrictions. */ }
    }
    function renderHistory() {
        historyContainer.replaceChildren();
        if (!history.length) {
            const empty = document.createElement('p');
            empty.className = 'empty-history';
            empty.textContent = 'No history yet';
            historyContainer.append(empty);
        }
        for (const item of history) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'history-item';
            button.setAttribute('aria-label', `Use result ${item.result} from ${item.expression}`);
            const expression = document.createElement('span');
            expression.className = 'history-expression';
            expression.textContent = item.expression + ' =';
            const result = document.createElement('span');
            result.className = 'history-result';
            result.textContent = item.result;
            button.append(expression, result);
            button.addEventListener('click', () => { update(item.result, true); closeMenu(); });
            historyContainer.append(button);
        }
    }
    function clearHistory() { history = []; saveHistory(); renderHistory(); }
    function setMenuOpen(open) {
        sidebar.classList.toggle('active', open);
        sidebar.inert = !open;
        sidebar.setAttribute('aria-hidden', String(!open));
        menuButton.classList.toggle('active', open);
        menuButton.setAttribute('aria-expanded', String(open));
        menuButton.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
    }
    function closeMenu() { setMenuOpen(false); }
    function changeMode(modeName) {
        const scientific = modeName === 'Scientific';
        document.getElementById('standardKeypad').hidden = scientific;
        document.getElementById('scientificKeypad').hidden = !scientific;
        document.getElementById('modeTitle').textContent = scientific ? 'SCIENTIFIC' : 'STANDARD';
        for (const mode of ['Standard', 'Scientific']) {
            const btn = document.getElementById('btnMode' + mode);
            btn.classList.toggle('active-mode', mode === modeName);
            btn.setAttribute('aria-pressed', String(mode === modeName));
        }
        closeMenu();
    }
    const actions = {
        number: appendNumber,
        operator: appendOperator,
        decimal: appendDecimal,
        percent: appendPercentage,
        parenthesis: appendParenthesis,
        constant: appendConstant,
        scientific: appendScientific,
        sign: toggleSign,
        clear: clearDisplay,
        delete: deleteLast,
        calculate,
        shift: toggleShift,
        mode: changeMode,
        'clear-history': clearHistory
    };
    document.querySelector('.calculator').addEventListener('click', event => {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const action = actions[button.dataset.action];
        if (action) action(button.dataset.value);
    });
    menuButton.addEventListener('click', event => {
        setMenuOpen(!sidebar.classList.contains('active'));
        event.stopPropagation();
    });
    document.addEventListener('click', event => {
        if (!sidebar.contains(event.target) && !menuButton.contains(event.target)) closeMenu();
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            event.preventDefault();
            if (sidebar.classList.contains('active')) closeMenu();
            else clearDisplay();
            return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey || event.target.closest('button')) return;
        if (event.key === 'Enter' || event.key === '=') {
            event.preventDefault();
            calculate();
            return;
        }
        if (event.target === display) return; // Native text editing, arrows and paste.
        if (/^\d$/.test(event.key)) { event.preventDefault(); appendNumber(event.key); }
        else if (['+', '-', '*', '/', '^'].includes(event.key)) { event.preventDefault(); appendOperator(event.key); }
        else if (event.key === '.') { event.preventDefault(); appendDecimal(); }
        else if (event.key === '%') { event.preventDefault(); appendPercentage(); }
        else if (event.key === '(' || event.key === ')') { event.preventDefault(); appendParenthesis(event.key); }
        else if (event.key === 'Backspace') { event.preventDefault(); deleteLast(); }
        else if (event.key === 'Delete') { event.preventDefault(); clearDisplay(); }
    });
    display.addEventListener('input', () => {
        resultShown = false;
     
    });
    renderHistory();
})();
