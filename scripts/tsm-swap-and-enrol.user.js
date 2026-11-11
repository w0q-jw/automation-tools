// ==UserScript==
// @name         TSM Swap and Enrol Assistant
// @namespace    Jaden-TSM
// @version      12.0
// @description  Batch TSM assistant - works through a paired remove/add list, then every remaining requiredByDegree single-section block, saves with Keep Changes and returns to SAR
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

        // The paired remove / add list typed into the panel.
        runPairs: true,

        // After every block is open, check each REMOVE line
        // again and clear anything still reserved.
        verifyRemovals: true,

        // After the paired list, click Standard on every
        // remaining block that has exactly one section code.
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
        remove: 8000,
        removeDialog: 2500,
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

        // After each Remove click
        afterRemove: 1500,

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


    const parseList = parseStudentIDs;


    // The panel takes CO numbers without the CR prefix
    // (314Z0080), the page shows them with it ([CR314Z0080]).
    function normaliseCO(value) {

        let result = String(value || '')
            .trim()
            .toUpperCase()
            .replace(/^\[/, '')
            .replace(/\]$/, '');

        if (!result) {
            return '';
        }

        if (!result.startsWith('CR')) {
            result = 'CR' + result;
        }

        return result;
    }


    function normaliseSection(value) {

        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim()
            .toUpperCase();
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

        return normaliseCO(match[1]);
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


    // The module <li> carries the degree flag:
    //
    //   <li class="requiredByDegree hasSectionReserved">
    //
    // Blocks without requiredByDegree are never picked up by
    // the automatic single-section sweep.
    function isRequiredByDegree(module) {

        if (!module) {
            return false;
        }

        const owner =
            (module.matches && module.matches('li'))
                ? module
                : (module.closest ? module.closest('li') : null);

        const target = owner || module;

        if (!target.classList) {
            return false;
        }

        return [...target.classList].some(
            name => name.toLowerCase() === 'requiredbydegree'
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


    // The section code: the hidden Section input is
    // authoritative (and copes with values like "-002RDA "),
    // with the second cell as the fallback.
    function getSectionCode(row) {

        if (!row) {
            return '';
        }

        const hidden = row.querySelector('input[name="Section"]');

        if (hidden && hidden.value) {
            return normaliseSection(hidden.value);
        }

        return normaliseSection(getSectionName(row));
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
            const required = isRequiredByDegree(module);

            let category;

            if (count === 1 && codes.length === 1) {
                category = required
                    ? 'EXACTLY ONE SECTION'
                    : 'EXACTLY ONE SECTION (not requiredByDegree)';
                singleSection++;
            } else if (count > 1 || codes.length > 1) {
                category = 'MULTIPLE SECTIONS';
                multipleSections++;
            } else {
                category = 'NO SECTIONS';
                noSections++;
            }

            results.push({
                co,
                count,
                codes,
                sections,
                category,
                required
            });
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

        if (element.getAttribute('data-reserve-button') === 'true') {
            return true;
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


    // TSM marks a section that is already held for this
    // student with .alreadyReservedMessage - clicking Standard
    // again on one of those is not wanted.
    function isAlreadyReserved(row) {

        if (!row) {
            return false;
        }

        const message = row.querySelector('.alreadyReservedMessage');

        return !!(message && isVisible(message));
    }


    function findStandardControl(row, module) {

        // The real control, as rendered by TSM.
        const reserve = [
            ...row.querySelectorAll('button[data-reserve-button="true"]')
        ].filter(isVisible)[0];

        if (reserve) {
            return reserve;
        }

        // Anything else in the row that reads as Standard.
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


    // Section rows, with the selective script's fallback for
    // builds where the row IDs differ.
    function sectionRowsOf(module) {

        const rows = getSectionRows(module);

        if (rows.length) {
            return rows;
        }

        if (!module) {
            return [];
        }

        return [
            ...module.querySelectorAll('tr')
        ].filter(
            row =>
                isVisible(row) &&
                row.querySelector('button[data-reserve-button="true"]')
        );
    }


    // =========================================================
    // CLICK ONE STANDARD BUTTON
    //
    // Shared by both phases. Soft verification: the control
    // usually disappears, becomes disabled or gains a selected
    // state. If none of that happens we still continue rather
    // than clicking again, to avoid double registration.
    // =========================================================

    async function clickStandard(control, label) {

        setStatus('Clicking Standard for ' + label + '...');

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
                'Standard confirmation for ' + label
            );

            await sleep(DELAY.afterStandard);

            return 'Standard clicked';

        } catch (error) {

            await sleep(DELAY.afterStandard);

            return 'Standard clicked (no visible confirmation)';
        }
    }


    function wasClicked(status) {
        return String(status || '').startsWith('Standard clicked');
    }


    // TSM re-renders the block list after every click, so a
    // row held from before the click is stale. Find it again.
    async function resolveRow(co, rowId, code) {

        const block = await findBlockByCO(co);

        await ensureExpanded(block);

        const module = getModule(await findBlockByCO(co));
        const rows = sectionRowsOf(module);

        if (rowId) {

            const byId = rows.find(row => row.id === rowId);

            if (byId) {
                return { row: byId, module };
            }
        }

        const byCode = rows.find(row => getSectionCode(row) === code);

        return { row: byCode || null, module };
    }


    // =========================================================
    // PAIRED ACTIONS
    //
    // The two boxes are read line by line and matched by
    // position. Odd lines (1st, 3rd, 5th...) are REMOVE,
    // even lines (2nd, 4th...) are ADD:
    //
    //   9G5Z0013   -0019F    → remove CR9G5Z0013-0019F
    //   9G5Z0013   -002RDA   → add    CR9G5Z0013 -002RDA
    //   9G5Z0014   -0011F    → remove CR9G5Z0014-0011F
    //   9G5Z0014   -002RDA   → add    CR9G5Z0014 -002RDA
    //
    // They are carried out in the order listed, so the seat
    // is released before its replacement is taken.
    // =========================================================

    function joinCourseId(co, section) {

        if (!section) {
            return co;
        }

        return section.startsWith('-')
            ? co + section
            : co + '-' + section;
    }


    function buildPairs(coLines, sectionLines) {

        const pairs = [];

        for (let index = 0; index < coLines.length; index++) {

            const co = normaliseCO(coLines[index]);
            const section = normaliseSection(sectionLines[index]);

            if (!co) {
                continue;
            }

            pairs.push({
                position: index + 1,
                action: index % 2 === 0 ? 'remove' : 'add',
                co,
                section,
                courseId: joinCourseId(co, section)
            });
        }

        return pairs;
    }


    // =========================================================
    // CURRENT COURSES (the reserved / registered pane)
    // =========================================================

    function currentCourseRows() {

        return [
            ...document.querySelectorAll('li.courseBasic')
        ].filter(
            item => item.querySelector('[data-unreserve="true"]')
        );
    }


    function courseIdOf(item) {

        if (!item) {
            return '';
        }

        const hidden = item.querySelector('input[name="CourseID"]');

        if (hidden && hidden.value) {
            return normaliseSection(hidden.value);
        }

        const title = item.querySelector('.courseTitle');

        const match =
            title &&
            title.textContent.match(/\[([^\]]+)\]/);

        return match ? normaliseSection(match[1]) : '';
    }


    // Unreserving may raise a confirmation dialog. Answer it
    // if it appears, carry on if it does not.
    async function confirmRemovalDialog() {

        let buttons = null;

        try {

            buttons = await waitFor(
                () => {

                    const found = [
                        ...document.querySelectorAll(
                            'button.okButton, .ui-dialog-buttonset button'
                        )
                    ].filter(isVisible);

                    return found.length ? found : null;

                },
                WAIT.removeDialog,
                'removal confirmation'
            );

        } catch (error) {

            return false;
        }

        const affirmative = buttons.find(
            button => /^(ok|yes|continue|remove|unreserve|confirm)$/
                .test(normalise(button.textContent))
        );

        await realMouseClick(affirmative || buttons[0]);

        await sleep(800);

        return true;
    }


    function wasRemoved(status) {
        return String(status || '').startsWith('Removed');
    }


    // The sidebar row for a block course carries only the CO
    // number (CR9G5Z0013), never the section, so an exact
    // CourseID match only works for non-block courses.
    function findReservedCourse(courseId) {

        return currentCourseRows().find(
            item => courseIdOf(item) === courseId
        ) || null;
    }


    // The offering ID is the reliable link between a section
    // row in the block and its row in the sidebar:
    //
    //   <tr id="AvailableSectionRow_242947"> ... -0019F
    //   <li class="courseBasic" data-offeringid="242947">
    //
    function offeringIdOfRow(row) {

        if (!row) {
            return '';
        }

        const fromId =
            String(row.id || '').match(/AvailableSectionRow_(\d+)/);

        if (fromId && fromId[1] !== '0') {
            return fromId[1];
        }

        const hidden =
            row.querySelector('input[name="CourseOfferingID"]');

        if (hidden && hidden.value && hidden.value !== '0') {
            return hidden.value;
        }

        const button = row.querySelector('[data-offering-id]');

        const fromButton =
            button && button.getAttribute('data-offering-id');

        return (fromButton && fromButton !== '0')
            ? fromButton
            : '';
    }


    function isReservedRow(row) {

        if (!row) {
            return false;
        }

        return (
            (row.classList && row.classList.contains('sectionReserved')) ||
            isAlreadyReserved(row)
        );
    }


    function reservedItemByOfferingId(offeringId) {

        if (!offeringId) {
            return null;
        }

        const item = document.querySelector(
            'li.courseBasic[data-offeringid="' + offeringId + '"]'
        );

        return (item && item.querySelector('[data-unreserve="true"]'))
            ? item
            : null;
    }


    function findSectionRow(module, section) {

        const rows = sectionRowsOf(module);

        const exact = rows.find(
            row => getSectionCode(row) === section
        );

        if (exact) {
            return exact;
        }

        if (section.length > 2) {

            return rows.find(
                row => getSectionCode(row).endsWith(section)
            ) || null;
        }

        return null;
    }


    // =========================================================
    // FIND THE SIDEBAR ROW FOR ONE CO + SECTION
    //
    // Three ways, best first:
    //   1. offering ID taken from the block's section row
    //   2. exact CourseID (works for non-block courses that
    //      carry the section in the sidebar)
    //   3. position - the Nth reserved section of that CO in
    //      the block is the Nth sidebar row for that CO
    // =========================================================

    async function locateReservedItem(pair) {

        let module = null;
        let row = null;

        try {

            const block = await findBlockByCO(pair.co);

            await ensureExpanded(block);

            module = getModule(await findBlockByCO(pair.co));
            row = findSectionRow(module, pair.section);

        } catch (error) {

            module = null;
        }

        // 1. Offering ID.
        if (row) {

            const offeringId = offeringIdOfRow(row);
            const byOffering = reservedItemByOfferingId(offeringId);

            if (byOffering) {

                return {
                    item: byOffering,
                    how: 'offering ' + offeringId
                };
            }
        }

        // 2. Exact CourseID.
        const byCourseId = findReservedCourse(pair.courseId);

        if (byCourseId) {
            return { item: byCourseId, how: 'course ID' };
        }

        // 3. Position among the reserved sections of this CO.
        if (row && module) {

            const reservedRows =
                sectionRowsOf(module).filter(isReservedRow);

            const index = reservedRows.indexOf(row);

            if (index >= 0) {

                const candidates = currentCourseRows().filter(
                    item => courseIdOf(item) === pair.co
                );

                if (candidates[index]) {

                    return {
                        item: candidates[index],
                        how: 'position ' + (index + 1)
                    };
                }
            }
        }

        return { item: null, row, module };
    }


    // =========================================================
    // CLICK ONE REMOVE BUTTON
    // =========================================================

    async function unreserveItem(item, label) {

        const control = item.querySelector('[data-unreserve="true"]');

        if (!control) {
            return 'No Remove control - skipped';
        }

        const offeringId = item.getAttribute('data-offeringid');

        setStatus('Removing ' + label + '...');

        await realMouseClick(control);

        await confirmRemovalDialog();

        try {

            await waitFor(
                () => {

                    if (!item.isConnected) {
                        return true;
                    }

                    if (offeringId) {

                        const still = document.querySelector(
                            'li.courseBasic[data-offeringid="' +
                            offeringId +
                            '"]'
                        );

                        return (
                            !still ||
                            !still.querySelector('[data-unreserve="true"]')
                        )
                            ? true
                            : null;
                    }

                    return isVisible(item) ? null : true;

                },
                WAIT.remove,
                'removal of ' + label
            );

            await sleep(DELAY.afterRemove);

            return 'Removed';

        } catch (error) {

            await sleep(DELAY.afterRemove);

            return 'Removed (no visible confirmation)';
        }
    }


    // =========================================================
    // REMOVE ONE COURSE SECTION
    // =========================================================

    async function removeCourse(pair) {

        const outcome = {
            position: pair.position,
            action: 'REMOVE',
            courseId: pair.courseId,
            status: ''
        };

        const found = await locateReservedItem(pair);

        // Never added in the first place - nothing to do.
        if (!found.item) {

            outcome.status = 'Not reserved - ignored';
            return outcome;
        }

        const status = await unreserveItem(found.item, pair.courseId);

        outcome.status =
            status.startsWith('Removed')
                ? status + ' (matched by ' + found.how + ')'
                : status;

        return outcome;
    }

    // =========================================================
    // ADD ONE SECTION
    // =========================================================

    async function addSection(pair) {

        const label = pair.co + ' ' + pair.section;

        const outcome = {
            position: pair.position,
            action: 'ADD',
            courseId: pair.courseId,
            status: ''
        };

        let block = null;

        try {

            block = await findBlockByCO(pair.co);

        } catch (error) {

            outcome.status = 'CO not found for this student';
            return outcome;
        }

        setStatus('Opening ' + pair.co + '...');

        await ensureExpanded(block);

        const module = getModule(await findBlockByCO(pair.co));
        const rows = sectionRowsOf(module);

        if (!rows.length) {

            outcome.status = 'No sections listed';
            return outcome;
        }

        // Exact section code first, then a tail match for
        // builds that prefix the cell with the CO number.
        let row = rows.find(
            item => getSectionCode(item) === pair.section
        );

        if (!row && pair.section.length > 2) {

            row = rows.find(
                item => getSectionCode(item).endsWith(pair.section)
            );
        }

        if (!row) {

            outcome.status =
                'Section not found (' +
                rows.map(getSectionCode).join(', ') +
                ')';

            return outcome;
        }

        if (isAlreadyReserved(row)) {

            outcome.status = 'Already reserved - skipped';
            return outcome;
        }

        const control = findStandardControl(row, module);

        if (!control) {

            outcome.status = 'No Standard button - skipped';
            return outcome;
        }

        outcome.status = await clickStandard(control, label);

        return outcome;
    }


    // =========================================================
    // VERIFY THE REMOVALS
    //
    // Run after every block has been opened. Each REMOVE line
    // is checked again against the reserved list, because the
    // sidebar row can only be tied to a section once the
    // block is expanded and its offering IDs are visible.
    // Anything still sitting there is removed now.
    // =========================================================

    async function verifyRemovals(pairs) {

        const outcomes = [];

        const removals = pairs.filter(
            pair => pair.action === 'remove'
        );

        if (!removals.length) {
            return outcomes;
        }

        setStatus('Double-checking removals...');

        for (const pair of removals) {

            checkStopped();

            let found = null;

            try {

                found = await locateReservedItem(pair);

            } catch (error) {

                outcomes.push({
                    position: pair.position,
                    action: 'CHECK',
                    courseId: pair.courseId,
                    status: 'Check failed: ' + error.message
                });

                continue;
            }

            if (!found.item) {

                outcomes.push({
                    position: pair.position,
                    action: 'CHECK',
                    courseId: pair.courseId,
                    status: 'Confirmed gone from reserved list'
                });

                continue;
            }

            // Still reserved - take it off now.
            setStatus(
                pair.courseId +
                ' is still reserved - removing it now...'
            );

            try {

                const status =
                    await unreserveItem(found.item, pair.courseId);

                outcomes.push({
                    position: pair.position,
                    action: 'CHECK',
                    courseId: pair.courseId,
                    status:
                        status.startsWith('Removed')
                            ? 'Still reserved → ' +
                              status +
                              ' (matched by ' + found.how + ')'
                            : 'Still reserved → ' + status
                });

            } catch (error) {

                outcomes.push({
                    position: pair.position,
                    action: 'CHECK',
                    courseId: pair.courseId,
                    status: 'Still reserved - retry failed: ' + error.message
                });
            }
        }

        return outcomes;
    }


    // =========================================================
    // RUN THE PAIRED LIST IN ORDER
    // =========================================================

    async function runPairedActions(pairs) {

        const outcomes = [];
        const handled = new Set();

        if (!pairs.length) {
            return { outcomes, handled };
        }

        setStatus(
            'Applying ' + pairs.length + ' paired action(s)...'
        );

        for (const pair of pairs) {

            checkStopped();

            // Either way the CO is spoken for, so phase 2
            // leaves it alone.
            handled.add(pair.co);

            try {

                outcomes.push(
                    pair.action === 'remove'
                        ? await removeCourse(pair)
                        : await addSection(pair)
                );

            } catch (error) {

                outcomes.push({
                    position: pair.position,
                    action: pair.action.toUpperCase(),
                    courseId: pair.courseId,
                    status: 'Failed: ' + error.message
                });
            }
        }

        return { outcomes, handled };
    }
    // =========================================================
    // PHASE 2 - ONE BLOCK WITH EXACTLY ONE SECTION CODE
    // =========================================================

    async function clickStandardForBlock(co) {

        const block = await findBlockByCO(co);

        await ensureExpanded(block);

        const module = getModule(await findBlockByCO(co));

        // Hard gate 1, re-checked against the live DOM: the
        // block must be flagged requiredByDegree.
        if (!isRequiredByDegree(module)) {

            return {
                co,
                status: 'Skipped - not requiredByDegree'
            };
        }

        const rows = sectionRowsOf(module);

        if (!rows.length) {

            return {
                co,
                status: 'No section rows found - skipped'
            };
        }

        // Hard gate 2, also re-checked live. More than one
        // section code means a human picks, so Standard is
        // never clicked here.
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

        if (isAlreadyReserved(row)) {

            return {
                co,
                status: 'Already reserved - skipped'
            };
        }

        const control = findStandardControl(row, module);

        if (!control) {

            return {
                co,
                status: 'No Standard control found - skipped'
            };
        }

        return {
            co,
            status: await clickStandard(control, co)
        };
    }


    // =========================================================
    // PHASE 2 - EVERY REMAINING SINGLE-SECTION BLOCK
    // =========================================================

    async function clickStandardForAll(analysis, handled) {

        const claimed = handled || new Set();

        const targets = analysis.results.filter(
            result =>
                result.required &&
                result.count === 1 &&
                result.codes.length === 1 &&
                !claimed.has(result.co)
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

    async function processStudent(studentId, request) {

        const pairs = request.pairs || [];

        setStatus('Processing student ' + studentId);

        await searchStudent(studentId);

        await openStudentRecord();

        await openRegistration();

        await selectAcademicYear();

        let pairOutcomes = [];
        let standardOutcomes = [];
        let handled = new Set();
        let saveStatus = 'Not saved (dry run)';

        // ---- Paired removes and adds, in the order listed ----

        if (CONFIG.runPairs && pairs.length && !CONFIG.dryRun) {

            const paired = await runPairedActions(pairs);

            pairOutcomes = paired.outcomes;
            handled = paired.handled;
        }

        if (CONFIG.dryRun) {

            for (const pair of pairs) {
                handled.add(pair.co);
            }
        }

        // The record is analysed AFTER the paired actions, so
        // the sweep sees the sections as they now stand.
        const blocks = await expandAllSummaryBlocks();

        // With every block open, each REMOVE line can be tied
        // to its sidebar row by offering ID and checked.
        let checkOutcomes = [];

        if (CONFIG.verifyRemovals && pairs.length && !CONFIG.dryRun) {

            checkOutcomes = await verifyRemovals(pairs);
        }

        const analysis = analyseBlocks(blocks);

        if (CONFIG.dryRun) {

            const preview = pairs.map(
                pair =>
                    pair.position +
                    '. ' +
                    (pair.action === 'remove' ? 'REMOVE' : 'ADD   ') +
                    ' ' +
                    pair.courseId +
                    (pair.action === 'remove'
                        ? (findReservedCourse(pair.courseId)
                            ? ' → is reserved, would be removed'
                            : ' → not reserved, would be ignored')
                        : '')
            );

            for (const result of analysis.results) {

                if (
                    result.count === 1 &&
                    result.codes.length === 1 &&
                    !handled.has(result.co)
                ) {

                    preview.push(
                        result.required
                            ? 'Sweep would click ' + result.co
                            : 'Sweep would SKIP ' +
                              result.co +
                              ' (not requiredByDegree)'
                    );
                }
            }

            setStatus(
                'DRY RUN - no buttons clicked.\n\n' +
                analysis.report.join('\n') +
                (preview.length
                    ? '\n\n' + preview.join('\n')
                    : '')
            );

        } else {

            // ---- Everything else with exactly one section ----

            if (CONFIG.clickStandard) {

                standardOutcomes =
                    await clickStandardForAll(analysis, handled);
            }

            const anyChange =
                pairOutcomes.some(
                    outcome =>
                        wasRemoved(outcome.status) ||
                        wasClicked(outcome.status)
                ) ||
                checkOutcomes.some(
                    outcome => outcome.status.includes('Removed')
                ) ||
                standardOutcomes.some(
                    outcome => wasClicked(outcome.status)
                );

            if (!CONFIG.clickKeepChanges) {

                saveStatus = 'Keep Changes disabled';

            } else if (!anyChange) {

                saveStatus = 'Nothing to save';

            } else {

                // One save covering removes, adds and phase 2.
                saveStatus = await clickKeepChanges();
            }
        }

        const lines = analysis.report.slice();

        if (pairOutcomes.length) {

            lines.push('');
            lines.push('REMOVE / ADD LIST');
            lines.push('=================');

            for (const outcome of pairOutcomes) {

                lines.push(
                    outcome.position +
                    '. ' +
                    outcome.action +
                    ' ' +
                    outcome.courseId +
                    ' → ' +
                    outcome.status
                );
            }
        }

        if (checkOutcomes.length) {

            lines.push('');
            lines.push('REMOVAL CHECK');
            lines.push('=============');

            for (const outcome of checkOutcomes) {

                lines.push(
                    outcome.position +
                    '. ' +
                    outcome.courseId +
                    ' → ' +
                    outcome.status
                );
            }
        }

        if (standardOutcomes.length) {

            lines.push('');
            lines.push('OTHER REQUIRED SINGLE-SECTION BLOCKS');
            lines.push('===================================');

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
            pairOutcomes,
            checkOutcomes,
            standardOutcomes,
            saveStatus,
            report: lines
        };
    }


    // =========================================================
    // PROCESS BATCH
    // =========================================================

    async function processBatch(studentIds, request) {

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

                    const outcome =
                        await processStudent(studentId, request);

                    const added = [
                        ...outcome.pairOutcomes,
                        ...outcome.standardOutcomes
                    ].filter(
                        item => wasClicked(item.status)
                    ).length;

                    const removed = outcome.pairOutcomes.filter(
                        item => wasRemoved(item.status)
                    ).length;

                    results.push({
                        studentId,
                        status: outcome.saveStatus,
                        removed,
                        clicked: added
                    });

                } catch (error) {

                    console.error('TSM batch error:', error);

                    results.push({
                        studentId,
                        status: 'Stopped: ' + error.message,
                        removed: 0,
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
                        ' — removed: ' +
                        result.removed +
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
                TSM Swap and Enrol
            </div>

            <label class="tsm-label" for="tsm-student-ids">
                Student IDs
            </label>

            <textarea
                id="tsm-student-ids"
                class="tsm-box tsm-tall"
                placeholder="One Student ID per line&#10;&#10;19937&#10;19938&#10;19939"
            ></textarea>

            <div class="tsm-note">
                Lines are matched by position.
                Line 1 = REMOVE, line 2 = ADD,
                line 3 = REMOVE, line 4 = ADD, and so on.
            </div>

            <label class="tsm-label" for="tsm-co-numbers">
                CO Numbers
            </label>

            <textarea
                id="tsm-co-numbers"
                class="tsm-box"
                placeholder="Without the CR prefix&#10;&#10;9G5Z0013&#10;9G5Z0013&#10;9G5Z0014&#10;9G5Z0014"
            ></textarea>

            <label class="tsm-label" for="tsm-sections">
                CO Section Codes
            </label>

            <textarea
                id="tsm-sections"
                class="tsm-box"
                placeholder="One per line, same order&#10;&#10;-0019F&#10;-002RDA&#10;-0011F&#10;-002RDA"
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

        panel.querySelectorAll('.tsm-note').forEach(
            note => {

                Object.assign(
                    note.style,
                    {
                        margin: '0 0 12px 0',
                        padding: '8px',
                        background: '#242424',
                        borderLeft: '3px solid #777',
                        borderRadius: '3px',
                        fontSize: '12px',
                        lineHeight: '1.5'
                    }
                );
            }
        );

        panel.querySelectorAll('.tsm-label').forEach(
            label => {

                Object.assign(
                    label.style,
                    {
                        display: 'block',
                        marginTop: '10px',
                        marginBottom: '5px',
                        fontWeight: 'bold'
                    }
                );
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
        const coInput = document.getElementById('tsm-co-numbers');
        const sectionInput = document.getElementById('tsm-sections');

        panel.querySelectorAll('.tsm-box').forEach(
            box => {

                Object.assign(
                    box.style,
                    {
                        width: '100%',
                        boxSizing: 'border-box',
                        minHeight: box.classList.contains('tsm-tall')
                            ? '110px'
                            : '70px',
                        padding: '9px',
                        fontSize: '13px',
                        marginBottom: '4px',
                        resize: 'vertical',
                        borderRadius: '4px',
                        border: '1px solid #777',
                        background: '#fff',
                        color: '#000'
                    }
                );
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

                const coLines = parseList(coInput.value);
                const sectionLines = parseList(sectionInput.value);

                // Lines are paired by position, so the two
                // boxes have to line up exactly.
                if (coLines.length !== sectionLines.length) {

                    setStatus(
                        '⚠ ' +
                        coLines.length +
                        ' CO number(s) but ' +
                        sectionLines.length +
                        ' section code(s).\n\n' +
                        'The two boxes are matched line by line, ' +
                        'so they must have the same number of lines.',
                        true
                    );

                    return;
                }

                const pairs = buildPairs(coLines, sectionLines);

                const action = CONFIG.dryRun
                    ? 'DRY RUN - nothing will be clicked or saved.'
                    : 'Removes and adds WILL be applied and saved.';

                const listed = pairs.length
                    ? 'REMOVE / ADD LIST:\n\n' +
                      pairs.map(
                          pair =>
                              pair.position +
                              '. ' +
                              (pair.action === 'remove'
                                  ? 'REMOVE '
                                  : 'ADD    ') +
                              pair.courseId
                      ).join('\n')
                    : 'No remove / add list entered.';

                const confirmation = window.confirm(
                    'START BATCH?\n\n' +
                    'Students:\n\n' +
                    studentIds.join('\n') +
                    '\n\n' +
                    listed +
                    '\n\n' +
                    'For each student:\n\n' +
                    '1. Open Student Academic Record\n' +
                    '2. Open Context Menu\n' +
                    '3. Open Registration\n' +
                    '4. Select ' + CONFIG.academicYear + '\n' +
                    '5. Work through the list above in order\n' +
                    '6. Re-check that every REMOVE line has gone\n' +
                    '   from the reserved list\n' +
                    '7. Then Standard on every OTHER block that\n' +
                    '   is requiredByDegree AND lists exactly\n' +
                    '   one section code\n' +
                    '8. Click Keep Changes once\n' +
                    '9. Main Menu → Academics → SAR\n\n' +
                    action + '\n\n' +
                    'Continue?'
                );

                if (!confirmation) {
                    return;
                }

                startButton.disabled = true;

                await processBatch(
                    studentIds,
                    { pairs }
                );
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
            'TSM Swap and Enrol Assistant v12.0 loaded.'
        );
    }


    if (document.readyState === 'loading') {

        document.addEventListener('DOMContentLoaded', start);

    } else {

        start();
    }

})();
