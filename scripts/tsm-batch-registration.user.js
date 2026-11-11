// ==UserScript==
// @name         TSM Single-Section Batch Registration Assistant
// @namespace    Jaden-TSM
// @version      7.2
// @description  Batch TSM assistant - opens Registration, expands Summary Blocks, clicks Standard on single-section blocks, saves with Keep Changes, then returns to SAR search
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================
    // SETTINGS
    // =========================================================

    const CONFIG = {
        academicYear: '2026-27',

        // Analyse only. No Standard, no Keep Changes.
        // Toggled by the checkbox in the panel.
        dryRun: false,

        // Click Standard - and ONLY on blocks that resolve to
        // exactly one section code. Blocks with two or more
        // section codes are never touched.
        clickStandard: true,

        // Save with Keep Changes at the end of each student.
        clickKeepChanges: true,

        // Carry on with the next student after a failure.
        continueOnError: true,

        // Retries for each important click.
        clickAttempts: 3
    };

    const WAIT = {
        searchBox: 30000,
        searchResult: 30000,
        studentRecord: 30000,
        contextMenu: 8000,
        contextMenuOpen: 4000,
        contextMenuLinks: 15000,
        registration: 30000,
        academicYear: 30000,
        academicYearOk: 8000,
        modules: 30000,
        expand: 6000,
        standard: 6000,
        keepChanges: 20000,
        keepChangesResult: 12000,
        returnSearch: 30000
    };

    const DELAY = {
        typing: 50,

        // Wait before attempting Context Menu
        beforeContextMenu: 3000,

        // Between Summary Blocks
        betweenCOs: 1200,

        // After each Standard click
        afterStandard: 1200,

        // After the record has been saved
        afterKeepChanges: 2500,

        // Academic year
        afterAcademicYear: 1000,

        // General
        afterOpen: 500
    };

    let stopped = false;
    let processing = false;


    // =========================================================
    // BASIC UTILITIES
    // =========================================================

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }


    function normalise(value) {

        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toLowerCase();
    }


    function isVisible(element) {

        if (!element) {
            return false;
        }

        if (!element.isConnected) {
            return false;
        }

        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();

        return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0' &&
            rect.width > 0 &&
            rect.height > 0
        );
    }


    function checkStopped() {

        if (stopped) {
            throw new Error('Stopped by user.');
        }
    }


    async function waitFor(
        condition,
        timeout = 30000,
        description = 'condition'
    ) {

        const start = Date.now();

        while (Date.now() - start < timeout) {

            checkStopped();

            try {

                const result = condition();

                if (result) {
                    return result;
                }

            } catch (error) {
                // TSM may temporarily alter the DOM.
            }

            await sleep(100);
        }

        throw new Error(
            'Timed out waiting for ' + description
        );
    }


    // =========================================================
    // MOUSE / POINTER EVENTS
    //
    // TSM controls are bound through jQuery delegates and do
    // not reliably respond to element.click() on its own.
    // =========================================================

    function fireMouse(element, type, extra) {

        element.dispatchEvent(
            new MouseEvent(
                type,
                Object.assign(
                    {
                        bubbles: true,
                        cancelable: true,
                        composed: true,
                        view: window
                    },
                    extra || {}
                )
            )
        );
    }


    function firePointer(element, type, extra) {

        if (typeof PointerEvent !== 'function') {
            return;
        }

        try {

            element.dispatchEvent(
                new PointerEvent(
                    type,
                    Object.assign(
                        {
                            bubbles: true,
                            cancelable: true,
                            composed: true,
                            view: window,
                            pointerId: 1,
                            pointerType: 'mouse',
                            isPrimary: true
                        },
                        extra || {}
                    )
                )
            );

        } catch (error) {}
    }


    async function hoverElement(element) {

        firePointer(element, 'pointerover');
        fireMouse(element, 'mouseover');
        fireMouse(element, 'mouseenter');
        fireMouse(element, 'mousemove');

        await sleep(100);
    }


    // Full pointer -> mouse -> click sequence.
    // Deliberately does NOT also call element.click(),
    // because that would fire toggle handlers twice and
    // immediately close the flyout it just opened.
    async function realMouseClick(element) {

        if (!element) {
            throw new Error('Element not found.');
        }

        element.scrollIntoView({
            behavior: 'instant',
            block: 'center',
            inline: 'center'
        });

        await sleep(120);

        await hoverElement(element);

        try {
            element.focus();
        } catch (error) {}

        firePointer(element, 'pointerdown', { buttons: 1 });
        fireMouse(element, 'mousedown', { buttons: 1 });

        await sleep(90);

        firePointer(element, 'pointerup', { buttons: 0 });
        fireMouse(element, 'mouseup', { buttons: 0 });

        await sleep(60);

        fireMouse(element, 'click');

        await sleep(200);
    }


    function nativeClick(element) {

        if (!element) {
            throw new Error('Element not found.');
        }

        element.scrollIntoView({
            behavior: 'instant',
            block: 'center',
            inline: 'center'
        });

        try {
            element.focus();
        } catch (error) {}

        element.click();
    }


    function keyboardActivate(element) {

        if (!element) {
            throw new Error('Element not found.');
        }

        element.scrollIntoView({
            behavior: 'instant',
            block: 'center',
            inline: 'center'
        });

        try {
            element.focus();
        } catch (error) {}

        const options = {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
        };

        element.dispatchEvent(
            new KeyboardEvent('keydown', options)
        );

        element.dispatchEvent(
            new KeyboardEvent('keypress', options)
        );

        element.dispatchEvent(
            new KeyboardEvent('keyup', options)
        );
    }


    function spaceActivate(element) {

        if (!element) {
            return;
        }

        try {
            element.focus();
        } catch (error) {}

        const options = {
            key: ' ',
            code: 'Space',
            keyCode: 32,
            which: 32,
            bubbles: true,
            cancelable: true
        };

        element.dispatchEvent(
            new KeyboardEvent('keydown', options)
        );

        element.dispatchEvent(
            new KeyboardEvent('keyup', options)
        );
    }


    function clickElement(element) {
        nativeClick(element);
    }


    // =========================================================
    // CLICK UNTIL SOMETHING ACTUALLY HAPPENS
    //
    // This is the core fix. Every important click is now
    // "click, then prove it worked, otherwise try again with
    // a different technique".
    // =========================================================

    async function clickUntil(options) {

        const {
            getElement,
            verify,
            description,
            attempts = CONFIG.clickAttempts,
            settle = 500,
            verifyTimeout = 8000,
            beforeRetry
        } = options;

        let lastError = null;

        for (
            let attempt = 1;
            attempt <= attempts;
            attempt++
        ) {

            checkStopped();

            const element = await getElement();

            if (!element) {

                lastError = new Error(
                    'Could not find element for ' + description
                );

                await sleep(600);
                continue;
            }

            if (attempt === 1) {
                await realMouseClick(element);
            } else if (attempt === 2) {
                nativeClick(element);
            } else {
                keyboardActivate(element);
            }

            await sleep(settle);

            try {

                return await waitFor(
                    verify,
                    verifyTimeout,
                    description
                );

            } catch (error) {

                checkStopped();

                lastError = error;

                setStatus(
                    'Retrying: ' +
                    description +
                    ' (attempt ' +
                    (attempt + 1) +
                    ' of ' +
                    attempts +
                    ')'
                );

                if (beforeRetry) {

                    try {
                        await beforeRetry(attempt);
                    } catch (retryError) {}
                }
            }
        }

        throw (
            lastError ||
            new Error('Failed: ' + description)
        );
    }


    function pressEscape() {

        const options = {
            key: 'Escape',
            code: 'Escape',
            keyCode: 27,
            which: 27,
            bubbles: true,
            cancelable: true
        };

        document.body.dispatchEvent(
            new KeyboardEvent('keydown', options)
        );

        document.body.dispatchEvent(
            new KeyboardEvent('keyup', options)
        );
    }


    // =========================================================
    // PARSE STUDENT IDS
    // =========================================================

    function parseStudentIDs(value) {

        return value
            .split(/[\n,;]+/)
            .map(item => item.trim())
            .filter(Boolean);
    }


    // =========================================================
    // TYPE INTO A FIELD
    // =========================================================

    async function typeInto(field, text) {

        field.focus();

        field.value = '';

        field.dispatchEvent(
            new Event('input', { bubbles: true })
        );

        for (const character of text) {

            checkStopped();

            field.dispatchEvent(
                new KeyboardEvent(
                    'keydown',
                    { key: character, bubbles: true }
                )
            );

            field.value += character;

            field.dispatchEvent(
                new Event('input', { bubbles: true })
            );

            field.dispatchEvent(
                new KeyboardEvent(
                    'keyup',
                    { key: character, bubbles: true }
                )
            );

            await sleep(DELAY.typing);
        }
    }


    function pressEnter(field) {

        const options = {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true
        };

        field.dispatchEvent(
            new KeyboardEvent('keydown', options)
        );

        field.dispatchEvent(
            new KeyboardEvent('keyup', options)
        );
    }


    // =========================================================
    // SEARCH STUDENT
    // =========================================================

    async function searchStudent(studentId) {

        setStatus(
            'Searching student ' + studentId + '...'
        );

        const searchBox =
            await waitFor(
                () => {

                    const element =
                        document.querySelector('#KeywordSearch');

                    return (element && isVisible(element))
                        ? element
                        : null;

                },
                WAIT.searchBox,
                'Student ID search box'
            );

        await typeInto(searchBox, studentId);

        pressEnter(searchBox);
    }


    // =========================================================
    // OPEN STUDENT RECORD
    // =========================================================

    async function openStudentRecord() {

        setStatus('Waiting for student search result...');

        const record =
            await waitFor(
                () => {

                    const records = [
                        ...document.querySelectorAll('.marqueeColumn')
                    ].filter(isVisible);

                    return records.find(
                        item => {

                            const label =
                                item.querySelector(
                                    'label[title="Student Academic Record ID"]'
                                );

                            const heading =
                                item.querySelector('.mainHeading');

                            return (
                                label &&
                                heading &&
                                isVisible(heading)
                            );
                        }
                    );

                },
                WAIT.searchResult,
                'student search result'
            );

        setStatus('Opening Student Academic Record...');

        await clickUntil({
            getElement: () => record.querySelector('.mainHeading'),
            verify: () => (
                document.querySelector('#studentregistrationblockTable') ||
                document.querySelector('#StudentRegistrationBlocks_0')
            ),
            description: 'Student Academic Record',
            verifyTimeout: WAIT.studentRecord
        });

        setStatus('✓ Student Academic Record loaded.');

        // Important delay before Context Menu.
        await sleep(DELAY.beforeContextMenu);
    }


    // =========================================================
    // CONTEXT MENU
    //
    // The page carries TWO context menu buttons: one in the
    // compact bar (name in a sr-only span, no title) and one
    // in .navFull (title="Context Menu" plus a btnText span).
    // Only one of them is really on screen, and clicking the
    // off-screen one silently does nothing - that was the bug.
    // The open state lives on the flyout: #contextMenu.active
    // =========================================================

    // Nav bars are always within the viewport, so anything
    // sitting outside it is the hidden duplicate.
    function isOnScreen(element) {

        if (!isVisible(element)) {
            return false;
        }

        const rect = element.getBoundingClientRect();

        return (
            rect.right > 0 &&
            rect.bottom > 0 &&
            rect.left < (window.innerWidth || 0) &&
            rect.top < (window.innerHeight || 0)
        );
    }


    function contextFlyout() {
        return document.getElementById('contextMenu');
    }


    function isContextFlyoutOpen() {

        const flyout = contextFlyout();

        return !!(
            flyout &&
            flyout.classList.contains('active')
        );
    }


    // Ordered best-first. Every candidate gets tried.
    function findContextMenuButtons() {

        const candidates = [
            ...document.querySelectorAll('[data-flyout="contextMenu"]')
        ].filter(isOnScreen);

        const scored = candidates.map(
            button => {

                const title = normalise(button.getAttribute('title'));
                const aria = normalise(button.getAttribute('aria-label'));

                const screenReader = normalise(
                    (button.querySelector('span.sr-only') || {}).textContent
                );

                let score = 0;

                // Whichever nav container is actually in use.
                if (button.closest('.navCompact.visible')) {
                    score += 10;
                }

                const container =
                    button.closest('.navCompact, .navFull');

                if (container && !isOnScreen(container)) {
                    score -= 10;
                }

                if (button.querySelector('span.icon.contextMenuIcon')) {
                    score += 4;
                }

                if (
                    screenReader === 'context menu' ||
                    title === 'context menu' ||
                    aria === 'context menu'
                ) {
                    score += 4;
                }

                if (button.getAttribute('aria-haspopup') === 'true') {
                    score += 1;
                }

                return { button, score };
            }
        );

        scored.sort((a, b) => b.score - a.score);

        return scored.map(entry => entry.button);
    }


    function findContextMenuButton() {
        return findContextMenuButtons()[0] || null;
    }


    function contextMenuIcon(button) {

        if (!button) {
            return null;
        }

        return (
            button.querySelector('span.icon.contextMenuIcon') ||
            button.querySelector('.icon')
        );
    }


    function markContextMenuActive(button) {

        const flyout = contextFlyout();

        if (flyout && !flyout.classList.contains('active')) {
            flyout.classList.add('active');
        }

        if (!button) {
            return;
        }

        if (!button.classList.contains('active')) {
            button.classList.add('active');
        }

        button.setAttribute('aria-expanded', 'true');
    }


    function closeAllFlyouts() {

        // TSM's own closer, when it is available.
        try {

            if (
                window.trs &&
                window.trs.ui &&
                typeof window.trs.ui.hideAllNavFlyouts === 'function'
            ) {

                window.trs.ui.hideAllNavFlyouts();
                return;
            }

        } catch (error) {}

        pressEscape();
    }


    function resetContextMenuButton(button) {

        if (!button) {
            return;
        }

        button.classList.remove('active');
        button.setAttribute('aria-expanded', 'false');
    }


    // =========================================================
    // REGISTRATION LINK
    //
    // Several links in the flyout point at
    // FromStudentAcademicRecord (Holds, SAR, T&C), so match on
    // the AdministrativeRegister path, which is unique to
    // Registration.
    // =========================================================

    const REGISTRATION_PATH =
        '/Registration/AdministrativeRegister/FromStudentAcademicRecord';


    function findRegistrationLink() {

        const flyout = contextFlyout();

        const scopes = [flyout, document].filter(Boolean);

        for (const scope of scopes) {

            const exact = [
                ...scope.querySelectorAll(
                    'a[href*="' + REGISTRATION_PATH + '"]'
                )
            ][0];

            if (exact) {
                return exact;
            }
        }

        // Fallback on the label.
        return [
            ...document.querySelectorAll(
                'a[href*="FromStudentAcademicRecord"]'
            )
        ].find(
            link => normalise(link.textContent) === 'registration'
        ) || null;
    }


    function registrationPageLoaded() {

        return (
            document.querySelector('#s2id_Session') ||
            document.querySelector('#reg_keepChanges') ||
            document.querySelector('.summaryBlock')
        );
    }


    // =========================================================
    // OPEN CONTEXT MENU
    //
    // Two-stage verification: first the flyout has to go
    // active, then the links have to render (they load lazily,
    // so this second wait has to be generous - closing the
    // flyout early was making it look like nothing happened).
    // =========================================================

    async function openContextMenu() {

        const existing = findRegistrationLink();

        if (existing && isContextFlyoutOpen()) {
            return existing;
        }

        const techniques = [
            {
                name: 'pointer',
                run: async button => {
                    await realMouseClick(button);
                }
            },
            {
                name: 'icon',
                run: async button => {
                    await realMouseClick(
                        contextMenuIcon(button) || button
                    );
                }
            },
            {
                name: 'native click',
                run: async button => {
                    nativeClick(button);
                }
            },
            {
                name: 'keyboard',
                run: async button => {
                    keyboardActivate(button);
                    await sleep(200);
                    spaceActivate(button);
                }
            },
            {
                name: 'active class',
                run: async button => {
                    markContextMenuActive(button);
                    await sleep(300);
                }
            }
        ];

        let lastError = null;

        for (const technique of techniques) {

            const buttons = findContextMenuButtons();

            if (!buttons.length) {

                lastError = new Error(
                    'No Context Menu button is on screen.'
                );

                await sleep(600);
                continue;
            }

            for (
                let index = 0;
                index < buttons.length;
                index++
            ) {

                checkStopped();

                const button = buttons[index];

                setStatus(
                    'Opening Context Menu (' +
                    technique.name +
                    (buttons.length > 1
                        ? ', button ' + (index + 1)
                        : '') +
                    ')...'
                );

                try {
                    await technique.run(button);
                } catch (error) {
                    lastError = error;
                }

                // Stage 1 - did the flyout go active?
                let opened = false;

                try {

                    await waitFor(
                        () => isContextFlyoutOpen() || findRegistrationLink(),
                        WAIT.contextMenuOpen,
                        'Context Menu to open'
                    );

                    opened = true;

                } catch (error) {

                    lastError = error;
                }

                if (!opened) {

                    // Nothing happened at all - reset and move on.
                    closeAllFlyouts();
                    resetContextMenuButton(button);
                    await sleep(600);
                    continue;
                }

                // Stage 2 - the links load lazily. Give them
                // real time instead of closing the flyout.
                try {

                    const link =
                        await waitFor(
                            findRegistrationLink,
                            WAIT.contextMenuLinks,
                            'Registration inside Context Menu'
                        );

                    markContextMenuActive(button);

                    setStatus('✓ Context Menu open.');

                    return link;

                } catch (error) {

                    checkStopped();

                    lastError = error;

                    closeAllFlyouts();
                    resetContextMenuButton(button);
                    await sleep(800);
                }
            }
        }

        throw (
            lastError ||
            new Error('Context Menu did not open.')
        );
    }


    // =========================================================
    // OPEN REGISTRATION
    // =========================================================

    async function openRegistration() {

        let link = null;

        try {

            link = await openContextMenu();

        } catch (error) {

            // The flyout would not open, but the links may
            // still be in the DOM from an earlier open.
            link = findRegistrationLink();

            if (!link) {
                throw error;
            }

            setStatus(
                'Context Menu would not open - using the ' +
                'Registration link directly...'
            );
        }

        setStatus('Opening Registration...');

        await clickUntil({

            getElement: () => findRegistrationLink() || link,

            // Wait for the Registration page itself, not a timer.
            verify: registrationPageLoaded,

            description: 'Registration page',
            verifyTimeout: WAIT.registration,

            beforeRetry: async () => {

                // The flyout may have closed itself.
                try {
                    await openContextMenu();
                } catch (error) {}
            }
        });

        setStatus('✓ Registration open.');
    }


    // =========================================================
    // OPEN ACADEMIC YEAR DROPDOWN
    // =========================================================

    async function openAcademicYearDropdown() {

        setStatus('Finding Academic Year dropdown...');

        const container =
            await waitFor(
                () => {

                    const element =
                        document.querySelector('#s2id_Session');

                    return (element && isVisible(element))
                        ? element
                        : null;

                },
                WAIT.academicYear,
                'Academic Year container'
            );

        setStatus('Opening Academic Year dropdown...');

        return await clickUntil({

            getElement: () => container.querySelector('a.select2-choice'),

            // Select2 needs the dropdown to exist before its
            // search input can be used.
            verify: () => {

                const inputs = [
                    ...document.querySelectorAll('input.select2-input')
                ].filter(isVisible);

                return inputs.find(
                    element => element.offsetParent !== null
                ) || null;
            },

            description: 'Academic Year search input',
            verifyTimeout: WAIT.academicYear
        });
    }


    // =========================================================
    // SELECT ACADEMIC YEAR
    // =========================================================

    async function selectAcademicYear() {

        const input = await openAcademicYearDropdown();

        setStatus(
            'Typing academic year ' + CONFIG.academicYear + '...'
        );

        await typeInto(input, CONFIG.academicYear);

        await sleep(1000);

        input.dispatchEvent(
            new KeyboardEvent(
                'keydown',
                {
                    key: 'ArrowDown',
                    code: 'ArrowDown',
                    keyCode: 40,
                    which: 40,
                    bubbles: true
                }
            )
        );

        await sleep(250);

        pressEnter(input);

        await sleep(500);

        // The OK dialog is not present on every TSM build,
        // so treat it as optional rather than fatal.
        let ok = null;

        try {

            ok = await waitFor(
                () => {

                    const buttons = [
                        ...document.querySelectorAll(
                            'button.okButton.ui-button.ui-corner-all.ui-widget'
                        )
                    ].filter(isVisible);

                    return buttons[0] || null;

                },
                WAIT.academicYearOk,
                'Academic Year OK button'
            );

        } catch (error) {

            setStatus('No Academic Year OK dialog - continuing.');
        }

        if (ok) {
            await realMouseClick(ok);
        }

        await sleep(DELAY.afterAcademicYear);

        setStatus('✓ Academic year selected.');
    }


    // =========================================================
    // SUMMARY BLOCKS
    // =========================================================

    function allSummaryBlocks() {

        return [
            ...document.querySelectorAll('.summaryBlock')
        ].filter(isVisible);
    }


    async function getSummaryBlocks() {

        return await waitFor(
            () => {

                const blocks = allSummaryBlocks();

                return blocks.length ? blocks : null;

            },
            WAIT.modules,
            'Summary Blocks'
        );
    }


    function getCONumber(summaryBlock) {

        if (!summaryBlock) {
            return null;
        }

        const bold = summaryBlock.querySelector('h3 b');

        if (!bold) {
            return null;
        }

        const match =
            bold.textContent.trim().match(/^\[([^\]]+)\]/);

        if (!match) {
            return null;
        }

        return match[1].trim().toUpperCase();
    }


    function getModule(summaryBlock) {

        if (!summaryBlock) {
            return null;
        }

        return (
            summaryBlock.closest('li') ||
            summaryBlock.parentElement
        );
    }


    function getSectionRows(module) {

        if (!module) {
            return [];
        }

        return [
            ...module.querySelectorAll(
                'tr[id^="AvailableSectionRow_"]'
            )
        ].filter(isVisible);
    }


    function getSectionName(row) {

        if (!row) {
            return '';
        }

        const cells = [...row.querySelectorAll('td')];

        if (cells.length >= 2) {
            return cells[1].textContent.trim();
        }

        return row.textContent.trim().replace(/\s+/g, ' ');
    }


    // The section code is what decides whether a block is
    // safe to auto-register. Falls back to the full section
    // text so two different sections never collapse into one.
    function getSectionCode(row) {

        if (!row) {
            return '';
        }

        const cells = [...row.querySelectorAll('td')];

        for (const cell of cells.slice(0, 2)) {

            const text = cell.textContent.trim().replace(/\s+/g, ' ');

            const match = text.match(
                /^([A-Za-z0-9][A-Za-z0-9._\-\/]{2,})/
            );

            if (match) {
                return match[1].toUpperCase();
            }
        }

        return normalise(getSectionName(row)).toUpperCase();
    }


    function uniqueSectionCodes(rows) {

        const codes = rows
            .map(getSectionCode)
            .filter(Boolean);

        return [...new Set(codes)];
    }


    // Re-find a block by its CO number.
    // Needed because TSM re-renders the block list after
    // every Standard click, invalidating old references.
    async function findBlockByCO(co) {

        return await waitFor(
            () => allSummaryBlocks().find(
                block => getCONumber(block) === co
            ) || null,
            10000,
            'Summary Block ' + co
        );
    }


    function isCollapsed(block) {

        const icon = block.querySelector('.icon');

        if (!icon) {
            return false;
        }

        return (
            icon.classList.contains('closed') ||
            icon.getAttribute('aria-expanded') === 'false'
        );
    }


    async function ensureExpanded(block) {

        if (!isCollapsed(block)) {
            return;
        }

        const icon = block.querySelector('.icon');

        if (!icon) {
            return;
        }

        const module = getModule(block);

        try {

            await clickUntil({
                getElement: () => block.querySelector('.icon'),
                verify: () => (
                    !isCollapsed(block) ||
                    getSectionRows(module).length > 0
                ),
                description: 'expanded ' + (getCONumber(block) || 'block'),
                attempts: 2,
                verifyTimeout: WAIT.expand
            });

        } catch (error) {

            // A block with no sections may never report as open.
        }
    }


    // =========================================================
    // EXPAND ALL SUMMARY BLOCKS
    // =========================================================

    async function expandAllSummaryBlocks() {

        const initial = await getSummaryBlocks();

        setStatus(
            'Found ' + initial.length + ' Summary Block(s).'
        );

        for (let index = 0; index < initial.length; index++) {

            checkStopped();

            // Re-query each time - the list can re-render.
            const blocks = allSummaryBlocks();
            const block = blocks[index];

            if (!block) {
                continue;
            }

            if (!isCollapsed(block)) {
                continue;
            }

            setStatus(
                'Opening ' + (getCONumber(block) || 'block') + '...'
            );

            await ensureExpanded(block);

            await sleep(DELAY.betweenCOs);
        }

        setStatus('✓ All Summary Blocks opened.');

        return await getSummaryBlocks();
    }


    // =========================================================
    // ANALYSE BLOCKS
    // =========================================================

    function analyseBlocks(blocks) {

        const results = [];

        let singleSection = 0;
        let multipleSections = 0;
        let noSections = 0;

        for (const block of blocks) {

            const co = getCONumber(block) || 'UNKNOWN CO';
            const module = getModule(block);
            const rows = getSectionRows(module);
            const count = rows.length;
            const sections = rows.map(getSectionName);
            const codes = uniqueSectionCodes(rows);

            let category;

            if (count === 1 && codes.length === 1) {
                category = 'EXACTLY ONE SECTION';
                singleSection++;
            } else if (count > 1 || codes.length > 1) {
                category = 'MULTIPLE SECTIONS';
                multipleSections++;
            } else {
                category = 'NO SECTIONS';
                noSections++;
            }

            results.push({ co, count, codes, sections, category });
        }

        const reportLines = [];

        reportLines.push('SUMMARY BLOCK ANALYSIS');
        reportLines.push('======================');
        reportLines.push('');

        for (const result of results) {

            reportLines.push(
                result.co +
                ' → ' +
                result.count +
                ' section(s), ' +
                result.codes.length +
                ' code(s) → ' +
                result.category
            );

            for (const section of result.sections) {
                reportLines.push('    • ' + section);
            }
        }

        reportLines.push('');
        reportLines.push('Exactly one section: ' + singleSection);
        reportLines.push('Multiple sections: ' + multipleSections);
        reportLines.push('No sections: ' + noSections);

        console.log('TSM analysis:', results);

        return {
            results,
            singleSection,
            multipleSections,
            noSections,
            report: reportLines
        };
    }


    // =========================================================
    // FIND THE STANDARD CONTROL
    //
    // Looks inside the section row first, then the whole
    // module. Matches on text, title, aria-label, value or id
    // so it survives TSM rendering it as a button, a link or
    // a styled span.
    // =========================================================

    const CLICKABLE =
        'button, a, input[type="button"], input[type="submit"], ' +
        'input[type="radio"], [role="button"], [onclick]';


    function looksLikeStandard(element) {

        if (element.disabled) {
            return false;
        }

        if (element.getAttribute('aria-disabled') === 'true') {
            return false;
        }

        const text = normalise(element.textContent);
        const title = normalise(element.getAttribute('title'));
        const aria = normalise(element.getAttribute('aria-label'));
        const value = normalise(element.value);
        const id = normalise(element.id);

        return (
            text === 'standard' ||
            title === 'standard' ||
            aria === 'standard' ||
            value === 'standard' ||
            /(^|[_-])standard([_-]|$)/.test(id)
        );
    }


    function findStandardControl(row, module) {

        // Inside the section row itself.
        const inRow = [
            ...row.querySelectorAll(CLICKABLE)
        ].filter(isVisible).find(looksLikeStandard);

        if (inRow) {
            return inRow;
        }

        if (!module) {
            return null;
        }

        // Elsewhere in the module - but never a control that
        // belongs to a different section row.
        return [
            ...module.querySelectorAll(CLICKABLE)
        ].filter(
            element => {

                if (!isVisible(element)) {
                    return false;
                }

                const owner = element.closest(
                    'tr[id^="AvailableSectionRow_"]'
                );

                return !owner || owner === row;
            }
        ).find(looksLikeStandard) || null;
    }


    // =========================================================
    // CLICK STANDARD FOR ONE BLOCK
    // =========================================================

    async function clickStandardForBlock(co) {

        const block = await findBlockByCO(co);

        await ensureExpanded(block);

        const module = getModule(block);
        const rows = getSectionRows(module);

        if (!rows.length) {

            return {
                co,
                status: 'No section rows found - skipped'
            };
        }

        // Hard gate, re-checked against the live DOM right
        // before clicking. More than one section code means
        // a human picks, so Standard is never clicked here.
        const codes = uniqueSectionCodes(rows);

        if (rows.length !== 1 || codes.length !== 1) {

            return {
                co,
                status:
                    'Skipped - ' +
                    rows.length +
                    ' section(s), ' +
                    codes.length +
                    ' code(s)'
            };
        }

        const row = rows[0];
        const control = findStandardControl(row, module);

        if (!control) {

            return {
                co,
                status: 'No Standard control found - skipped'
            };
        }

        setStatus('Clicking Standard for ' + co + '...');

        // Soft verification: the control usually disappears,
        // becomes disabled or gains a selected state. If none
        // of that happens we still continue rather than
        // clicking again, to avoid double registration.
        const before = control.className;

        await realMouseClick(control);

        try {

            await waitFor(
                () => {

                    if (!control.isConnected) {
                        return true;
                    }

                    if (!isVisible(control)) {
                        return true;
                    }

                    if (control.disabled) {
                        return true;
                    }

                    if (control.className !== before) {
                        return true;
                    }

                    if (control.getAttribute('aria-pressed') === 'true') {
                        return true;
                    }

                    if (control.checked) {
                        return true;
                    }

                    return null;

                },
                WAIT.standard,
                'Standard confirmation for ' + co
            );

            await sleep(DELAY.afterStandard);

            return { co, status: 'Standard clicked' };

        } catch (error) {

            await sleep(DELAY.afterStandard);

            return {
                co,
                status: 'Standard clicked (no visible confirmation)'
            };
        }
    }


    // =========================================================
    // CLICK STANDARD FOR EVERY TARGET BLOCK
    // =========================================================

    async function clickStandardForAll(analysis) {

        const targets = analysis.results.filter(
            result =>
                result.count === 1 &&
                result.codes.length === 1
        );

        const outcomes = [];

        for (const target of targets) {

            checkStopped();

            try {

                outcomes.push(
                    await clickStandardForBlock(target.co)
                );

            } catch (error) {

                outcomes.push({
                    co: target.co,
                    status: 'Failed: ' + error.message
                });
            }
        }

        return outcomes;
    }


    // =========================================================
    // KEEP CHANGES
    // =========================================================

    function findKeepChanges() {

        const button =
            document.querySelector('#reg_keepChanges');

        if (
            button &&
            isVisible(button) &&
            !button.disabled
        ) {
            return button;
        }

        // Fallback if the ID ever changes.
        return [
            ...document.querySelectorAll('button, input[type="button"]')
        ].filter(isVisible).find(
            element =>
                normalise(element.textContent) === 'keep changes' ||
                normalise(element.value) === 'keep changes'
        ) || null;
    }


    function keepChangesResolved() {

        const dialog = [
            ...document.querySelectorAll(
                'button.okButton, .ui-dialog-buttonset button'
            )
        ].filter(isVisible)[0];

        if (dialog) {
            return { dialog };
        }

        const button = document.querySelector('#reg_keepChanges');

        if (!button || !isVisible(button) || button.disabled) {
            return { saved: true };
        }

        return null;
    }


    async function clickKeepChanges() {

        setStatus('Saving with Keep Changes...');

        const button =
            await waitFor(
                findKeepChanges,
                WAIT.keepChanges,
                'Keep Changes button'
            );

        // Clicked once on purpose. A second save click is
        // riskier than a missed confirmation, so retries here
        // are limited and conditional.
        await realMouseClick(button);

        let outcome = null;

        try {

            outcome = await waitFor(
                keepChangesResolved,
                WAIT.keepChangesResult,
                'Keep Changes to be accepted'
            );

        } catch (error) {

            const still = document.querySelector('#reg_keepChanges');

            if (still && isVisible(still) && !still.disabled) {

                setStatus(
                    'Keep Changes did not respond - retrying once...'
                );

                nativeClick(still);

                try {

                    outcome = await waitFor(
                        keepChangesResolved,
                        WAIT.keepChangesResult,
                        'Keep Changes to be accepted'
                    );

                } catch (secondError) {

                    outcome = null;
                }
            }
        }

        if (outcome && outcome.dialog) {

            setStatus('Confirming save dialog...');

            await realMouseClick(outcome.dialog);

            await sleep(1000);
        }

        await sleep(DELAY.afterKeepChanges);

        if (!outcome) {

            setStatus(
                '⚠ Keep Changes clicked but no confirmation was ' +
                'detected. Check this student manually.'
            );

            return 'Keep Changes clicked - unconfirmed';
        }

        setStatus('✓ Changes saved.');

        return 'Saved';
    }


    // =========================================================
    // RETURN TO SAR SEARCH
    //
    // Main Menu → Academics → Student Academic Record
    // =========================================================

    async function returnToSAR() {

        setStatus('Returning to SAR search...');

        // ---- Main Menu ----

        await clickUntil({

            getElement: async () =>
                await waitFor(
                    () => {

                        const button =
                            document.querySelector('#mosaicMenuButton');

                        return (button && isVisible(button))
                            ? button
                            : null;

                    },
                    WAIT.returnSearch,
                    'Main Menu button'
                ),

            verify: () => [
                ...document.querySelectorAll('.btnText')
            ].filter(isVisible).find(
                element => normalise(element.textContent) === 'academics'
            ) || null,

            description: 'Main Menu to open'
        });

        // ---- Academics ----

        await clickUntil({

            getElement: () => {

                const label = [
                    ...document.querySelectorAll('.btnText')
                ].filter(isVisible).find(
                    element =>
                        normalise(element.textContent) === 'academics'
                );

                if (!label) {
                    return null;
                }

                // Click the button/link wrapping the label.
                return (
                    label.closest('button, a, [role="button"]') ||
                    label
                );
            },

            verify: () => findSARMenuItem(),

            description: 'Academics menu'
        });

        // ---- Student Academic Record ----

        await clickUntil({

            getElement: () => findSARMenuItem(),

            verify: () => {

                const search =
                    document.querySelector('#KeywordSearch');

                return (search && isVisible(search))
                    ? search
                    : null;
            },

            description: 'SAR search page',
            verifyTimeout: WAIT.returnSearch
        });

        setStatus('✓ Returned to SAR search.');
    }


    function findSARMenuItem() {

        const exact = document.querySelector('#Menu_136');

        if (exact && isVisible(exact)) {
            return exact;
        }

        return [
            ...document.querySelectorAll('a')
        ].filter(isVisible).find(
            link => {

                const href = link.getAttribute('href') || '';

                return (
                    normalise(link.textContent) ===
                        'student academic record' &&
                    href.includes(
                        '/Registration/StudentMatriculation/Search'
                    )
                );
            }
        ) || null;
    }


    // =========================================================
    // PROCESS ONE STUDENT
    // =========================================================

    async function processStudent(studentId) {

        setStatus('Processing student ' + studentId);

        await searchStudent(studentId);

        await openStudentRecord();

        await openRegistration();

        await selectAcademicYear();

        const blocks = await expandAllSummaryBlocks();

        const analysis = analyseBlocks(blocks);

        setStatus(
            'Student ' + studentId + '\n\n' +
            analysis.report.join('\n')
        );

        let standardOutcomes = [];
        let saveStatus = 'Not saved (dry run)';

        if (CONFIG.dryRun) {

            setStatus(
                'DRY RUN - no buttons clicked.\n\n' +
                analysis.report.join('\n')
            );

        } else {

            if (CONFIG.clickStandard) {
                standardOutcomes = await clickStandardForAll(analysis);
            }

            if (CONFIG.clickKeepChanges) {

                if (standardOutcomes.some(
                    outcome => outcome.status === 'Standard clicked' ||
                        outcome.status ===
                            'Standard clicked (no visible confirmation)'
                )) {

                    saveStatus = await clickKeepChanges();

                } else {

                    saveStatus = 'Nothing to save';
                }

            } else {

                saveStatus = 'Keep Changes disabled';
            }
        }

        const lines = analysis.report.slice();

        if (standardOutcomes.length) {

            lines.push('');
            lines.push('STANDARD CLICKS');
            lines.push('===============');

            for (const outcome of standardOutcomes) {
                lines.push(outcome.co + ' → ' + outcome.status);
            }
        }

        lines.push('');
        lines.push('Save: ' + saveStatus);

        setStatus(
            '✓ STUDENT COMPLETE\n\n' +
            'Student: ' + studentId + '\n\n' +
            lines.join('\n')
        );

        await sleep(1000);

        await returnToSAR();

        return {
            analysis,
            standardOutcomes,
            saveStatus,
            report: lines
        };
    }


    // =========================================================
    // PROCESS BATCH
    // =========================================================

    async function processBatch(studentIds) {

        if (!studentIds.length) {
            throw new Error('No Student IDs entered.');
        }

        stopped = false;
        processing = true;

        const results = [];

        try {

            for (
                let index = 0;
                index < studentIds.length;
                index++
            ) {

                checkStopped();

                const studentId = studentIds[index];

                setStatus(
                    'BATCH ' +
                    (index + 1) +
                    ' / ' +
                    studentIds.length +
                    '\n\nStudent: ' +
                    studentId
                );

                try {

                    const outcome = await processStudent(studentId);

                    results.push({
                        studentId,
                        status: outcome.saveStatus,
                        single: outcome.analysis.singleSection,
                        clicked: outcome.standardOutcomes.length
                    });

                } catch (error) {

                    console.error('TSM batch error:', error);

                    results.push({
                        studentId,
                        status: 'Stopped: ' + error.message,
                        single: 0,
                        clicked: 0
                    });

                    if (stopped || !CONFIG.continueOnError) {
                        throw error;
                    }

                    // Try to get back to a known page so the
                    // next student can still be processed.
                    setStatus(
                        'Recovering after error on ' +
                        studentId +
                        '...'
                    );

                    try {

                        await returnToSAR();

                    } catch (recoveryError) {

                        setStatus(
                            'Could not recover after ' +
                            studentId +
                            '. Batch stopped.',
                            true
                        );

                        throw error;
                    }
                }
            }

            setStatus(
                '✓ BATCH COMPLETE\n\n' +
                results.map(
                    result =>
                        result.studentId +
                        ' — ' +
                        result.status +
                        ' — single-section: ' +
                        result.single +
                        ' — Standard clicks: ' +
                        result.clicked
                ).join('\n')
            );

        } catch (error) {

            setStatus(
                'BATCH ENDED\n\n' +
                error.message +
                '\n\n' +
                results.map(
                    result =>
                        result.studentId + ' — ' + result.status
                ).join('\n'),
                true
            );

        } finally {

            processing = false;

            const button =
                document.getElementById('tsm-start-batch');

            if (button) {
                button.disabled = false;
            }
        }
    }


    // =========================================================
    // USER INTERFACE
    // =========================================================

    function createPanel() {

        if (document.getElementById('tsm-batch-panel')) {
            return;
        }

        const panel = document.createElement('div');

        panel.id = 'tsm-batch-panel';

        panel.innerHTML = `

            <div class="tsm-title">
                TSM Batch Registration
            </div>

            <label for="tsm-student-ids">
                Student IDs
            </label>

            <textarea
                id="tsm-student-ids"
                placeholder="One Student ID per line&#10;&#10;19937&#10;19938&#10;19939"
            ></textarea>

            <label class="tsm-check">
                <input type="checkbox" id="tsm-dry-run">
                Dry run - analyse only, click nothing
            </label>

            <button id="tsm-start-batch">
                START BATCH
            </button>

            <button id="tsm-stop">
                STOP
            </button>

            <div id="tsm-status">
                Ready
            </div>
        `;

        Object.assign(
            panel.style,
            {
                position: 'fixed',
                top: '20px',
                right: '20px',
                width: '370px',
                padding: '16px',
                background: '#151515',
                color: '#fff',
                border: '2px solid #555',
                borderRadius: '10px',
                zIndex: '2147483647',
                fontFamily: 'Arial, sans-serif',
                fontSize: '14px',
                boxShadow: '0 5px 20px rgba(0,0,0,0.5)'
            }
        );

        document.body.appendChild(panel);

        Object.assign(
            panel.querySelector('.tsm-title').style,
            {
                fontWeight: 'bold',
                fontSize: '18px',
                marginBottom: '14px'
            }
        );

        Object.assign(
            panel.querySelector('label[for="tsm-student-ids"]').style,
            {
                display: 'block',
                marginBottom: '5px',
                fontWeight: 'bold'
            }
        );

        panel.querySelectorAll('.tsm-check').forEach(
            label => {

                Object.assign(
                    label.style,
                    {
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        margin: '6px 0',
                        fontSize: '13px',
                        cursor: 'pointer'
                    }
                );
            }
        );

        const input = document.getElementById('tsm-student-ids');

        Object.assign(
            input.style,
            {
                width: '100%',
                boxSizing: 'border-box',
                minHeight: '140px',
                padding: '9px',
                fontSize: '13px',
                marginBottom: '8px',
                resize: 'vertical',
                borderRadius: '4px',
                border: '1px solid #777',
                background: '#fff',
                color: '#000'
            }
        );

        panel.querySelectorAll('button').forEach(
            button => {

                Object.assign(
                    button.style,
                    {
                        width: '100%',
                        padding: '10px',
                        marginTop: '7px',
                        cursor: 'pointer',
                        fontWeight: 'bold'
                    }
                );
            }
        );

        const status = document.getElementById('tsm-status');

        Object.assign(
            status.style,
            {
                marginTop: '12px',
                padding: '10px',
                background: '#292929',
                borderRadius: '5px',
                fontSize: '12px',
                lineHeight: '1.5',
                whiteSpace: 'pre-line',
                maxHeight: '400px',
                overflowY: 'auto'
            }
        );

        // ---- Options ----

        const dryRun = document.getElementById('tsm-dry-run');

        dryRun.checked = CONFIG.dryRun;

        dryRun.addEventListener('change', () => {
            CONFIG.dryRun = dryRun.checked;
        });

        // ---- Start ----

        const startButton =
            document.getElementById('tsm-start-batch');

        startButton.addEventListener(
            'click',
            async () => {

                if (processing) {
                    return;
                }

                const studentIds = parseStudentIDs(input.value);

                if (!studentIds.length) {

                    setStatus(
                        '⚠ Enter at least one Student ID.',
                        true
                    );

                    input.focus();

                    return;
                }

                const action = CONFIG.dryRun
                    ? 'DRY RUN - nothing will be clicked or saved.'
                    : 'Standard WILL be clicked and changes WILL be saved.';

                const confirmation = window.confirm(
                    'START BATCH?\n\n' +
                    'Students:\n\n' +
                    studentIds.join('\n') +
                    '\n\n' +
                    'For each student:\n\n' +
                    '1. Open Student Academic Record\n' +
                    '2. Open Context Menu\n' +
                    '3. Open Registration\n' +
                    '4. Select ' + CONFIG.academicYear + '\n' +
                    '5. Open all Summary Blocks\n' +
                    '6. Count sections in each block\n' +
                    '7. Click Standard ONLY where there is\n' +
                    '   exactly one section code\n' +
                    '8. Click Keep Changes\n' +
                    '9. Main Menu → Academics → SAR\n\n' +
                    action + '\n\n' +
                    'Continue?'
                );

                if (!confirmation) {
                    return;
                }

                startButton.disabled = true;

                await processBatch(studentIds);
            }
        );

        // ---- Stop ----

        const stopButton = document.getElementById('tsm-stop');

        stopButton.addEventListener(
            'click',
            () => {

                if (!processing) {
                    return;
                }

                stopped = true;

                setStatus(
                    'STOP REQUESTED\n\n' +
                    'The current operation will stop safely.',
                    true
                );
            }
        );

        // ---- Ctrl + Enter ----

        input.addEventListener(
            'keydown',
            event => {

                if (event.key === 'Enter' && event.ctrlKey) {

                    event.preventDefault();

                    startButton.click();
                }
            }
        );
    }


    // =========================================================
    // STATUS
    // =========================================================

    function setStatus(message, error = false) {

        const status = document.getElementById('tsm-status');

        if (!status) {
            return;
        }

        status.textContent = message;

        status.style.background = error ? '#5c1f1f' : '#292929';
    }


    // =========================================================
    // START
    // =========================================================

    function start() {

        createPanel();

        console.log(
            'TSM Batch Registration Assistant v7.2 loaded.'
        );
    }


    if (document.readyState === 'loading') {

        document.addEventListener('DOMContentLoaded', start);

    } else {

        start();
    }

})();
