// ==UserScript==
// @name         TSM Payment and Registration Assistant
// @namespace    Jaden-TSM
// @version      4.1
// @description  Batch TSM assistant - sets the preferred payment method, enrols every requiredByDegree block, processes the registration, then moves to the next student
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

        // Report only. Nothing is saved or processed.
        // Toggled by the checkbox in the panel.
        dryRun: false,

        // Only click Standard where a requiredByDegree block
        // lists exactly one section. With several sections
        // there is a real choice to be made, so it is left
        // for a human and flagged in the report. Set this to
        // false to click the first section instead.
        requireSingleSection: true,

        // A finance hold on the record means hands off: the
        // student is skipped and noted on the report card.
        skipOnFinanceHold: true,

        // The enrolment row for this academic year must carry
        // an Enrolment Standing. An empty one means the year
        // has not been signed off, so the student is skipped.
        requireEnrolmentStanding: true,
        standingYear: '2025-26',

        // Year 1 students have no previous year to sign off,
        // so the standing check does not apply to them.
        skipStandingForYearOne: true,

        // Only touch a student whose Enrolment Status reads
        // "Ready for Enrolment". Toggled in the panel.
        onlyIfReady: true,

        // Blocks are only opened for a student carrying NO
        // reserved credits. Any hours at all mean the modules
        // are already on, so it goes straight to the summary.
        // Raise this if you ever want a tolerance.
        maxReservedHours: 0,

        // Tick "Check Required" before the blocks are opened,
        // so only the required ones are listed.
        checkRequired: true,

        // If more blocks than this are still listed after the
        // tick, the student may already be enrolled - the
        // sidebar is checked before anything is clicked.
        manyBlocks: 14,

        // More than this many courses already sitting in the
        // Selected Courses sidebar means the enrolling has
        // been done: go straight to Registration Summary.
        alreadySelected: 3,

        // A dialog with an Override button sometimes follows
        // Process Registration. It is answered automatically,
        // up to this many times per student.
        maxOverrides: 3,

        // Process Registration is pressed once, and once more
        // only if answering an Override left it unsent.
        maxProcessClicks: 2,

        // Confirmation dialogs after processing - OK and
        // Save and Continue - cleared in any order.
        maxConfirmRounds: 3,

        // A student who fails on a timeout - a menu that did
        // not open, a field that never appeared - is tried
        // again from the top with every delay and timeout
        // stretched by this much each time, up to the cap.
        // Typing speed is left alone.
        slowdownStep: 0.05,
        slowdownMax: 0.25,

        // A batch left mid-flight is only resumed if it was
        // saved within this many minutes.
        resumeWindowMinutes: 30,

        // The return to SAR sometimes stops short of the
        // search page. This many Back presses are used to
        // recover before giving up.
        backAttempts: 3,

        // Carry on with the next student after a failure.
        continueOnError: true,

        // Retries for each important click.
        clickAttempts: 3
    };


    const WAIT = {
        searchBox: 30000,
        searchResult: 30000,
        studentRecord: 30000,
        enrolmentStatus: 15000,
        enrolmentTable: 15000,
        contextMenu: 8000,
        contextMenuOpen: 4000,
        contextMenuLinks: 15000,
        registration: 30000,
        academicYear: 30000,
        academicYearOk: 8000,
        modules: 30000,
        checkRequired: 8000,
        expand: 6000,
        standard: 6000,
        remove: 8000,
        removeDialog: 2500,
        financialAccounts: 30000,
        accountEdit: 20000,
        paymentMethod: 20000,
        okButton: 8000,
        save: 20000,
        saveResult: 20000,
        summary: 20000,
        processResult: 30000,
        finalOk: 15000,
        returnSearch: 30000,
        backStep: 8000
    };

    const DELAY = {
        typing: 50,

        // Settling time either side of the Context Menu.
        // The page is often still finishing a save or a page
        // load when the menu is reached.
        beforeContextMenu: 3000,
        afterContextMenu: 3000,

        // The account page keeps loading for a moment after
        // it appears, and Edit does nothing if clicked early
        beforeEdit: 7000,

        // Let the search settle before a result is clicked,
        // so the previous student's row is never the one
        // that gets opened
        afterSearch: 3000,

        // The block list redraws after Check Required
        afterCheckRequired: 3000,

        // Between Summary Blocks
        betweenCOs: 1200,

        // After each Standard click
        afterStandard: 1200,

        // Every Save press is followed by processing time
        afterSave: 10000,

        // After answering an Override dialog
        afterOverride: 1500,

        // After the registration has been processed
        afterProcess: 5000,

        // Settling time after the final OK before heading
        // back to the search, and between Back presses when
        // it stops short
        beforeReturn: 5000,
        beforeBack: 3000,

        // Settling time before picking a batch back up after
        // the page has reloaded under the script
        beforeResume: 5000,

        // Academic year
        afterAcademicYear: 1000,

        // General
        afterOpen: 500
    };

    // Every delay and timeout above, kept so a retry can
    // stretch them and then put them back.
    const BASE_DELAY = Object.assign({}, DELAY);
    const BASE_WAIT = Object.assign({}, WAIT);

    let slowdown = 1;


    // factor 1.05 = everything 5% slower. Typing is never
    // touched: it is a per-character delay, not a wait.
    function applySlowdown(factor) {

        slowdown = factor;

        for (const key of Object.keys(BASE_DELAY)) {

            DELAY[key] = (key === 'typing')
                ? BASE_DELAY[key]
                : Math.round(BASE_DELAY[key] * factor);
        }

        for (const key of Object.keys(BASE_WAIT)) {
            WAIT[key] = Math.round(BASE_WAIT[key] * factor);
        }
    }


    function slowdownLabel() {
        return '+' + Math.round((slowdown - 1) * 100) + '%';
    }


    // The failures worth another go: nothing happened in time.
    function isTimeoutError(error) {

        return /timed out waiting for|did not open|could not find element for|is on screen|was never pressed/i
            .test(String((error && error.message) || ''));
    }


    // @match *://*/* runs this in every frame on the page.
    // Only the top frame gets a panel: an iframe's copy would
    // draw a second one that Hide never touched, which looks
    // exactly like Hide doing nothing.
    const isTopFrame = (function () {

        try {
            return window.top === window.self;
        } catch (error) {
            return false;
        }
    })();


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

        const field =
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

        await typeInto(field, studentId);

        // typeInto clears first, but a stale value here would
        // search for the previous student all over again.
        if (String(field.value).trim() !== String(studentId).trim()) {

            field.value = studentId;

            field.dispatchEvent(
                new Event('input', { bubbles: true })
            );
        }

        pressEnter(field);

        // Let the results redraw before anything is clicked -
        // the previous student's row lingers for a moment.
        await sleep(DELAY.afterSearch);
    }


    // =========================================================
    // OPEN STUDENT RECORD
    // =========================================================

    function findAnyResult() {

        const records = [
            ...document.querySelectorAll('.marqueeColumn')
        ].filter(isVisible);

        return records.find(
            item => {

                const label = item.querySelector(
                    'label[title="Student Academic Record ID"]'
                );

                const heading = item.querySelector('.mainHeading');

                return label && heading && isVisible(heading);
            }
        ) || null;
    }


    // Preferred when the ID happens to appear in the result.
    function findResultFor(studentId) {

        const wanted = String(studentId).trim();

        const records = [
            ...document.querySelectorAll('.marqueeColumn')
        ].filter(isVisible);

        return records.find(
            item => {

                const heading = item.querySelector('.mainHeading');

                if (!heading || !isVisible(heading)) {
                    return false;
                }

                // The ID appears in the result's own text.
                return item.textContent.includes(wanted);
            }
        ) || null;
    }


    async function openStudentRecord(studentId) {

        setStatus('Waiting for student search result...');

        // Wait for a usable result, exactly as before - the
        // ID is not always printed in the result text, so it
        // is never waited on.
        const anyResult =
            await waitFor(
                findAnyResult,
                WAIT.searchResult,
                'student search result'
            );

        // If one of the results does carry the ID, prefer it.
        // No extra waiting either way.
        const record = findResultFor(studentId) || anyResult;

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

    // Registration is reached from two contexts here:
    //   /AdministrativeRegister/FromStudentAcademicRecord
    //   /AdministrativeRegister/FromPerson
    // so match the controller, not the entry point.
    const REGISTRATION_PATH = '/Registration/AdministrativeRegister/';

    const FINANCIAL_PATH =
        '/Financials/FinancialAccount/RedirectFromPersonContext';


    function findLinkInFlyout(path, label) {

        const flyout = contextFlyout();

        const scopes = [flyout, document].filter(Boolean);

        for (const scope of scopes) {

            const exact = [
                ...scope.querySelectorAll('a[href*="' + path + '"]')
            ][0];

            if (exact) {
                return exact;
            }
        }

        // Fallback on the label.
        return [
            ...document.querySelectorAll('a[href]')
        ].find(
            link =>
                isVisible(link) &&
                normalise(link.textContent) === label
        ) || null;
    }


    function findRegistrationLink() {
        return findLinkInFlyout(REGISTRATION_PATH, 'registration');
    }


    function findFinancialAccountsLink() {
        return findLinkInFlyout(FINANCIAL_PATH, 'financial accounts');
    }


    // Either link proves the flyout is open and populated.
    function findAnyContextLink() {
        return findRegistrationLink() || findFinancialAccountsLink();
    }


    function registrationPageLoaded() {

        return (
            document.querySelector('#s2id_Session') ||
            document.querySelector('#reg_loadSummary') ||
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

        const existing = findAnyContextLink();

        if (existing && isContextFlyoutOpen()) {
            return existing;
        }

        // Let the page finish whatever it is doing first -
        // a save, a page load - before touching the menu.
        setStatus('Waiting before the Context Menu...');

        await sleep(DELAY.beforeContextMenu);

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
                        () => isContextFlyoutOpen() || findAnyContextLink(),
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
                            findAnyContextLink,
                            WAIT.contextMenuLinks,
                            'links inside Context Menu'
                        );

                    markContextMenuActive(button);

                    setStatus(
                        '✓ Context Menu open. Waiting before ' +
                        'clicking through...'
                    );

                    // Give the flyout time to finish rendering
                    // every group before anything is clicked.
                    await sleep(DELAY.afterContextMenu);

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

        // Press OK to commit the year. Not every build raises
        // the dialog, so a miss is not fatal.
        let ok = null;

        try {

            ok = await waitFor(
                findOkButton,
                WAIT.academicYearOk,
                'Academic Year OK button'
            );

        } catch (error) {

            setStatus('No Academic Year OK dialog - continuing.');
        }

        if (ok) {

            setStatus('Clicking OK...');

            await realMouseClick(ok);

            // Wait for the dialog to close before moving on.
            try {

                await waitFor(
                    () => (
                        !ok.isConnected ||
                        !isVisible(ok)
                    ) ? true : null,
                    WAIT.okButton,
                    'the Academic Year dialog to close'
                );

            } catch (error) {}
        }

        await sleep(DELAY.afterAcademicYear);

        setStatus('✓ Academic year selected.');
    }


    // =========================================================
    // ENROLMENT STATUS
    //
    //   <div class="field">
    //     <label for="EnrollmentStatus">Enrolment Status ID</label>
    //     <span>Enrolled</span>
    //   </div>
    //
    // Only "Ready for Enrolment" is worked on. Anything with
    // "Enrolled" in it is already done.
    // =========================================================

    function findEnrolmentStatusText() {

        const label =
            document.querySelector('label[for="EnrollmentStatus"]') ||
            [...document.querySelectorAll('label')].find(
                item => normalise(item.textContent)
                    .startsWith('enrolment status')
            );

        if (!label) {
            return '';
        }

        const field = label.closest('.field') || label.parentElement;

        if (!field) {
            return '';
        }

        const span = field.querySelector('span');

        return span ? normalise(span.textContent) : '';
    }


    async function readEnrolmentStatus() {

        try {

            return await waitFor(
                () => findEnrolmentStatusText() || null,
                WAIT.enrolmentStatus,
                'the Enrolment Status field'
            );

        } catch (error) {

            return '';
        }
    }


    function isReadyForEnrolment(status) {
        return normalise(status).includes('ready for enrolment');
    }


    function isAlreadyEnrolled(status) {

        const text = normalise(status);

        return text.includes('enrolled') && !isReadyForEnrolment(text);
    }


    // =========================================================
    // FINANCE HOLD
    //
    //   <span class="icon holdIcon"> </span>
    //
    // Present on the record when the student is held. Nothing
    // is touched in that case.
    // =========================================================

    function findHoldIcon() {

        return [
            ...document.querySelectorAll('.icon.holdIcon')
        ].find(isVisible) || null;
    }


    // =========================================================
    // LEVEL OF STUDY
    //
    //   <label for="LevelOfStudy">Level of Study</label>
    //   <span>Year 1</span>
    //
    // The enrolment table has its own Level of Study column,
    // so the record level field is matched exactly and the
    // fallback never looks inside a table.
    // =========================================================

    function findLevelOfStudyText() {

        const exact =
            document.querySelector('label[for="LevelOfStudy"]');

        const label = exact || [
            ...document.querySelectorAll('label')
        ].find(
            item =>
                !item.closest('table') &&
                normalise(item.textContent).startsWith('level of study')
        );

        if (!label) {
            return '';
        }

        const field = label.closest('.field') || label.parentElement;

        if (!field) {
            return '';
        }

        const span = field.querySelector('span');

        return span ? normalise(span.textContent) : '';
    }


    function isYearOne(level) {

        const text = normalise(level);

        return (
            /(^|\W)year\s*1(\W|$)/.test(text) ||
            text === '1' ||
            /(^|\W)yr\s*1(\W|$)/.test(text)
        );
    }


    // =========================================================
    // ENROLMENT STANDING
    //
    // The enrolment block lists one row per period:
    //
    //   Period | Start | Type | Status | STANDING | ...
    //   2025-26 academic year | ... | Enrolled | Pass Year
    //
    // An empty Standing for the year in question means the
    // student is not ready, so they are skipped.
    // =========================================================

    function enrolmentRows() {

        return [
            ...document.querySelectorAll(
                '[id="enrollmentTable"] tr[id^="Enrollment_"]'
            )
        ].filter(
            // Top level rows only: Enrollment_0, Enrollment_1.
            // Not the journal rows or the reveal rows.
            row => /^Enrollment_\d+$/.test(row.id)
        );
    }


    function standingOfRow(row) {

        const cells = [...row.querySelectorAll(':scope > td')];

        // Period | Start Date | Type | Status | Standing
        const text = cells[4]
            ? cleanText(cells[4].textContent)
            : '';

        const hidden = row.querySelector(
            '[name$=".EnrollmentStandingID"]'
        );

        return {
            text,
            id: hidden ? cleanText(hidden.value) : '',
            period: cells[0] ? cleanText(cells[0].textContent) : '',
            status: cells[3] ? cleanText(cells[3].textContent) : ''
        };
    }


    function cleanText(value) {

        return String(value || '')
            .replace(/\s+/g, ' ')
            .trim();
    }


    // The row for the year we care about, or the closest thing
    // to it.
    function findStandingForYear(year) {

        const wanted = normalise(year);

        const rows = enrolmentRows().map(standingOfRow);

        if (!rows.length) {
            return null;
        }

        return rows.find(
            row => normalise(row.period).includes(wanted)
        ) || null;
    }


    async function readEnrolmentStanding(year) {

        try {

            await waitFor(
                () => enrolmentRows().length ? true : null,
                WAIT.enrolmentTable,
                'the enrolment table'
            );

        } catch (error) {

            return { missing: true, rows: [] };
        }

        const found = findStandingForYear(year);

        return {
            missing: !found,
            row: found,
            rows: enrolmentRows().map(standingOfRow)
        };
    }


    // =========================================================
    // RESERVED HOURS
    //
    //   <span id="ReservedHours">210&nbsp;Hours</span>
    // =========================================================

    function readReservedHours() {

        const span = document.querySelector('#ReservedHours');

        if (!span) {
            return null;
        }

        const digits = span.textContent.replace(/[^0-9.]/g, '');

        if (!digits) {
            return null;
        }

        const hours = parseFloat(digits);

        return isNaN(hours) ? null : hours;
    }


    // =========================================================
    // CHECK REQUIRED
    //
    // Ticked before the blocks are opened so the list only
    // carries what the degree actually requires.
    // =========================================================

    function findCheckRequired() {

        const box =
            document.querySelector('#CheckRequired') ||
            document.querySelector('input[name="CheckRequired"]');

        return (box && isVisible(box) && !box.disabled) ? box : null;
    }


    async function ensureCheckRequired() {

        const box = findCheckRequired();

        if (!box) {

            setStatus('No Check Required box on this page.');

            return 'not present';
        }

        if (box.checked) {

            setStatus('✓ Check Required is already ticked.');

            return 'already ticked';
        }

        setStatus('Ticking Check Required...');

        await realMouseClick(box);

        if (!box.checked) {

            // Some builds only respond to the native click.
            nativeClick(box);
        }

        if (!box.checked) {

            box.checked = true;

            box.dispatchEvent(new Event('change', { bubbles: true }));
        }

        try {

            await waitFor(
                () => {

                    const current = findCheckRequired();

                    return (current && current.checked) ? true : null;

                },
                WAIT.checkRequired,
                'Check Required to be ticked'
            );

        } catch (error) {

            setStatus('⚠ Check Required would not tick.');

            return 'would not tick';
        }

        // The block list redraws after the tick.
        await sleep(DELAY.afterCheckRequired);

        setStatus('✓ Check Required ticked.');

        return 'ticked';
    }


    // =========================================================
    // SELECTED COURSES SIDEBAR
    //
    // Each course already reserved or registered carries an
    // inspect icon. Several of them means the enrolling has
    // been done already.
    // =========================================================

    function regSidebar() {

        return (
            document.querySelector('.sideBar.regSidebar') ||
            document.querySelector('.regSidebar')
        );
    }


    // Counted whether or not the sidebar is expanded - the
    // rows are in the DOM either way.
    function countSelectedCourses() {

        const sidebar = regSidebar();

        if (!sidebar) {
            return 0;
        }

        const icons = sidebar.querySelectorAll(
            '.icon.inspectIcon[data-view-details="true"]'
        );

        if (icons.length) {
            return icons.length;
        }

        // Fall back on the course rows themselves.
        return sidebar.querySelectorAll(
            '#reservedCourseList li.courseBasic, ' +
            '#registeredCourseList li.courseBasic, ' +
            '#waitlistCourseList li.courseBasic'
        ).length;
    }


    async function openSidebar() {

        const sidebar = regSidebar();

        if (!sidebar) {
            return false;
        }

        const expander =
            sidebar.querySelector('.sideBarControl') ||
            sidebar.querySelector('.icon.sbExpander');

        if (!expander) {
            return false;
        }

        setStatus('Opening the Selected Courses sidebar...');

        await realMouseClick(expander);

        await sleep(1000);

        return true;
    }


    // Opens the sidebar if nothing is showing, then counts.
    async function countAlreadySelected() {

        let count = countSelectedCourses();

        if (!count) {

            await openSidebar();

            count = countSelectedCourses();
        }

        return count;
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

    // Only requiredByDegree blocks are opened. The rest are
    // never enrolled into, so opening them is wasted time.
    async function expandAllSummaryBlocks() {

        const initial = await getSummaryBlocks();

        const required = initial.filter(
            block => isRequiredByDegree(getModule(block))
        );

        setStatus(
            'Found ' +
            initial.length +
            ' Summary Block(s), ' +
            required.length +
            ' required by degree.'
        );

        for (let index = 0; index < initial.length; index++) {

            checkStopped();

            // Re-query each time - the list can re-render.
            const blocks = allSummaryBlocks();
            const block = blocks[index];

            if (!block) {
                continue;
            }

            if (!isRequiredByDegree(getModule(block))) {
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

        setStatus(
            '✓ ' + required.length + ' required block(s) opened.'
        );

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


    // =========================================================
    // RETURN TO SAR SEARCH
    //
    // Main Menu → Academics → Student Academic Record
    // =========================================================

    // Both nav bars carry these, so the off-screen duplicate
    // is filtered out the same way as the Context Menu button.
    function findMainMenuButton() {

        const byId = document.getElementById('mosaicMenuButton');

        if (byId && isOnScreen(byId)) {
            return byId;
        }

        return [
            ...document.querySelectorAll('button')
        ].filter(
            button =>
                isOnScreen(button) &&
                button.querySelector('span.icon.menuIcon')
        )[0] || null;
    }


    function findAcademicsButton() {

        const byFlyout = [
            ...document.querySelectorAll(
                'button[data-flyout="academicMenu"]'
            )
        ].filter(isOnScreen)[0];

        if (byFlyout) {
            return byFlyout;
        }

        const label = [
            ...document.querySelectorAll('.btnText')
        ].filter(isOnScreen).find(
            element => normalise(element.textContent) === 'academics'
        );

        if (!label) {
            return null;
        }

        // Click the button wrapping the label, not the span.
        return (
            label.closest('button, a, [role="button"]') || label
        );
    }


    async function returnToSAR() {

        setStatus('Returning to SAR search...');

        // ---- Main Menu ----

        await clickUntil({

            getElement: async () =>
                await waitFor(
                    findMainMenuButton,
                    WAIT.returnSearch,
                    'Main Menu button'
                ),

            verify: () => findAcademicsButton(),

            description: 'Main Menu to open'
        });

        // ---- Academics ----

        await clickUntil({

            getElement: () => findAcademicsButton(),
            verify: () => findSARMenuItem(),
            description: 'Academics menu'
        });

        // ---- Student Academic Record ----

        try {

            await clickUntil({

                getElement: () => findSARMenuItem(),
                verify: searchBox,
                description: 'SAR search page',
                verifyTimeout: WAIT.returnSearch
            });

        } catch (error) {

            // Handled by the Back recovery below.
        }

        await ensureSearchPage();

        setStatus('✓ Returned to SAR search.');
    }


    function searchBox() {

        const search = document.querySelector('#KeywordSearch');

        return (search && isVisible(search)) ? search : null;
    }


    // The nav carries two Back buttons - the compact bar and
    // the full bar - so the off-screen duplicate is filtered
    // out the same way as the Context Menu button.
    function findBackButton() {

        return [
            ...document.querySelectorAll(
                'button.primaryBackButton, #btnBack2, button'
            )
        ].filter(
            button =>
                isOnScreen(button) &&
                button.querySelector('span.icon.backArrow')
        )[0] || null;
    }


    // The menu route sometimes stops short of the search page.
    // Pressing Back finishes the journey.
    async function ensureSearchPage() {

        if (searchBox()) {
            return true;
        }

        for (
            let attempt = 1;
            attempt <= CONFIG.backAttempts;
            attempt++
        ) {

            checkStopped();

            const back = findBackButton();

            if (!back) {
                break;
            }

            setStatus(
                'Not on the search page yet - pressing Back (' +
                attempt +
                ')...'
            );

            await sleep(DELAY.beforeBack);

            // It may have arrived while we waited.
            if (searchBox()) {
                return true;
            }

            await realMouseClick(back);

            try {

                await waitFor(
                    searchBox,
                    WAIT.backStep,
                    'the SAR search page'
                );

                return true;

            } catch (error) {

                // Try again, or fall through to the last wait.
            }
        }

        // Last chance - the page may simply be slow.
        await waitFor(
            searchBox,
            WAIT.returnSearch,
            'SAR search page'
        );

        return true;
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
    // OPEN FINANCIAL ACCOUNTS FROM THE CONTEXT MENU
    // =========================================================

    async function openFinancialAccounts() {

        // openContextMenu waits 3s before and 3s after.
        await openContextMenu();

        setStatus('Opening Financial Accounts...');

        await clickUntil({

            getElement: () => findFinancialAccountsLink(),

            // The account itself, not just any Edit button -
            // a stale one from the previous page would look
            // like the page had already arrived.
            verify: () => (
                document.querySelector('#Account') ||
                document.querySelector('#accountWrapper') ||
                findEditButton()
            ),

            description: 'Financial Accounts page',
            verifyTimeout: WAIT.financialAccounts,

            beforeRetry: async () => {

                try {
                    await openContextMenu();
                } catch (error) {}
            }
        });

        // The page keeps loading for a moment after it first
        // appears, and Edit does nothing if clicked too early.
        setStatus('Financial Accounts open - letting it load...');

        await sleep(DELAY.beforeEdit);

        setStatus('✓ Financial Accounts open.');
    }


    // =========================================================
    // EDIT THE ACCOUNT
    // =========================================================

    function findEditButton() {

        const byHandler = [
            ...document.querySelectorAll('button[onclick*="editItem"]')
        ].filter(isVisible)[0];

        if (byHandler) {
            return byHandler;
        }

        return [
            ...document.querySelectorAll('button')
        ].filter(isVisible).find(
            button =>
                normalise(button.textContent) === 'edit' ||
                button.querySelector('span.editIcon')
        ) || null;
    }


    function findPaymentMethodContainer() {

        const container =
            document.querySelector('#s2id_PreferredPaymentMethodsIDs');

        return (container && isVisible(container)) ? container : null;
    }


    async function openAccountForEdit() {

        setStatus('Clicking Edit...');

        await clickUntil({

            getElement: () => findEditButton(),

            // Edit mode is confirmed by the payment method
            // field appearing.
            verify: () => (
                findPaymentMethodContainer() ||
                findSaveButton()
            ),

            description: 'account edit form',
            verifyTimeout: WAIT.accountEdit
        });

        setStatus('✓ Account open for editing.');
    }


    // =========================================================
    // PREFERRED PAYMENT METHOD
    //
    // A select2 MULTI select: the search input lives inside
    // the container and typing into it opens the list.
    // =========================================================

    function paymentMethodInput() {

        const container = findPaymentMethodContainer();

        if (!container) {
            return null;
        }

        const input = container.querySelector('input.select2-input');

        return (input && isVisible(input)) ? input : null;
    }


    function currentPaymentMethods() {

        const container = findPaymentMethodContainer();

        if (!container) {
            return [];
        }

        return [
            ...container.querySelectorAll('li.select2-search-choice')
        ].map(
            choice => normalise(choice.textContent)
        ).filter(Boolean);
    }


    async function setPaymentMethod(method) {

        const wanted = normalise(method);

        const container =
            await waitFor(
                findPaymentMethodContainer,
                WAIT.paymentMethod,
                'Preferred Payment Method field'
            );

        const already = currentPaymentMethods();

        if (already.some(choice => choice.includes(wanted))) {

            setStatus(
                'Payment method already set to ' + method + '.'
            );

            return 'Already set';
        }

        setStatus('Setting payment method to ' + method + '...');

        const input =
            await waitFor(
                paymentMethodInput,
                WAIT.paymentMethod,
                'Payment Method search input'
            );

        // Clicking the container focuses the search field and
        // opens the drop-down.
        await realMouseClick(input);

        await typeInto(input, method);

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

        await sleep(600);

        // Confirm the choice was actually taken.
        try {

            await waitFor(
                () => currentPaymentMethods().some(
                    choice => choice.includes(wanted)
                ) || null,
                WAIT.paymentMethod,
                'payment method to be selected'
            );

            return 'Set';

        } catch (error) {

            return 'Typed but not confirmed - check this student';
        }
    }


    // =========================================================
    // OK AND SAVE
    // =========================================================

    // "OK" / "Ok" on a jQuery UI dialog. The registration
    // submit buttons also carry .okButton, so they are
    // excluded explicitly.
    function findOkButton() {

        const candidates = [
            ...document.querySelectorAll('button.okButton')
        ].filter(
            button =>
                isVisible(button) &&
                !/^SubmitRegistrationButton/.test(button.id || '')
        );

        const dialog = candidates.find(
            button => button.classList.contains('ui-button')
        );

        if (dialog) {
            return dialog;
        }

        return candidates.find(
            button => normalise(button.textContent) === 'ok'
        ) || candidates[0] || null;
    }


    function findSaveButton() {

        const byData = [
            ...document.querySelectorAll('button[data-save-button="true"]')
        ].filter(isVisible)[0];

        if (byData) {
            return byData;
        }

        return [
            ...document.querySelectorAll('button')
        ].filter(isVisible).find(
            button =>
                normalise(button.textContent) === 'save' ||
                button.querySelector('span.saveIcon')
        ) || null;
    }


    async function confirmWithOk() {

        // Not every build raises the OK dialog, so this is
        // optional rather than fatal.
        let ok = null;

        try {

            ok = await waitFor(
                findOkButton,
                WAIT.okButton,
                'OK button'
            );

        } catch (error) {

            return false;
        }

        setStatus('Clicking OK...');

        await realMouseClick(ok);

        await sleep(800);

        return true;
    }


    async function saveAccount() {

        const save =
            await waitFor(
                findSaveButton,
                WAIT.save,
                'Save button'
            );

        setStatus('Saving the account...');

        await realMouseClick(save);

        // The save takes a few seconds. Wait for the form to
        // close rather than for a fixed delay, then settle.
        try {

            await waitFor(
                () => {

                    const still = findSaveButton();

                    if (!still || !isVisible(still)) {
                        return true;
                    }

                    if (still.disabled) {
                        return true;
                    }

                    if (!still.classList.contains('saveDirty')) {
                        return true;
                    }

                    return null;

                },
                WAIT.saveResult,
                'the account to save'
            );

            await sleep(DELAY.afterSave);

            setStatus('✓ Account saved.');

            return 'Saved';

        } catch (error) {

            await sleep(DELAY.afterSave);

            setStatus(
                '⚠ Save clicked but no confirmation was seen.'
            );

            return 'Save clicked - unconfirmed';
        }
    }


    // =========================================================
    // THE WHOLE PAYMENT METHOD STEP
    // =========================================================

    async function applyPaymentMethod(method) {

        await openFinancialAccounts();

        await openAccountForEdit();

        const status = await setPaymentMethod(method);

        await confirmWithOk();

        const saved = await saveAccount();

        return status + ' / ' + saved;
    }


    // =========================================================
    // STANDARD ON EVERY requiredByDegree BLOCK
    // =========================================================

    async function clickStandardForBlock(co) {

        const block = await findBlockByCO(co);

        await ensureExpanded(block);

        const module = getModule(await findBlockByCO(co));

        // Re-checked against the live DOM right before the
        // click, because the list re-renders after each one.
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

        const codes = uniqueSectionCodes(rows);

        // With several sections there is a real choice to be
        // made, so this is left for a human. Set
        // CONFIG.requireSingleSection = false to click the
        // first section instead.
        if (
            CONFIG.requireSingleSection &&
            (rows.length !== 1 || codes.length !== 1)
        ) {

            // "More than one Standard button" specifically:
            // more than one row on offer. (A single row with
            // an unreadable section code also lands here, but
            // that is a data problem, not an option course, so
            // it is not tagged as one.)
            const multiOption = rows.length > 1;

            return {
                co,
                status:
                    'SKIPPED - ' +
                    rows.length +
                    ' section(s), ' +
                    codes.length +
                    ' code(s) - needs a manual choice',
                multiOption,
                sections: multiOption ? rows.map(getSectionName) : undefined
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


    async function clickStandardForRequired(analysis) {

        const targets = analysis.results.filter(
            result => result.required
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
    // REGISTRATION SUMMARY → PROCESS REGISTRATION
    // =========================================================

    function findSummaryButton() {

        const button = document.querySelector('#reg_loadSummary');

        if (button && isVisible(button)) {
            return button;
        }

        return [
            ...document.querySelectorAll('button')
        ].filter(isVisible).find(
            item => normalise(item.textContent) === 'registration summary'
        ) || null;
    }


    // Pressing Registration Summary sometimes opens a slide
    // pane instead - "Mandatory Courses Not Selected" - whose
    // Proceed button submits the registration.
    function findSliderProceedButton() {

        const button = document.querySelector(
            '#SubmitRegistrationButtonFromSlider'
        );

        return (button && isVisible(button) && !button.disabled)
            ? button
            : null;
    }


    function findMainProcessButton() {

        const button =
            document.querySelector('#SubmitRegistrationButton');

        return (button && isVisible(button) && !button.disabled)
            ? button
            : null;
    }


    // The slide pane sits on top, so it wins when both exist.
    function findProcessButton() {

        return findSliderProceedButton() || findMainProcessButton();
    }


    // Processing sometimes raises a dialog whose only useful
    // control is Override. It is answered when it appears and
    // ignored when it does not.
    function findOverrideButton() {

        const byClass = [
            ...document.querySelectorAll('button.overrideButton')
        ].filter(isVisible)[0];

        if (byClass) {
            return byClass;
        }

        return [
            ...document.querySelectorAll(
                '.ui-dialog-buttonset button, button.ui-button'
            )
        ].filter(isVisible).find(
            button => normalise(button.textContent) === 'override'
        ) || null;
    }


    // Filled in by processRegistration so the end-of-batch
    // report can say whether Override was pressed.
    let lastOverrides = 0;
    let lastProceeds = 0;


    // The student being worked on, and a note of what has
    // happened to them, written to the saved run AS IT
    // HAPPENS. Pressing Override or OK often reloads the
    // page, which kills this script mid-student - anything
    // only recorded at the end of processStudent would be
    // lost, which is why overrides were reported as "no".
    let currentStudentId = '';


    function recordFact(patch) {

        if (!currentStudentId) {
            return;
        }

        try {

            const run = (loadSettings().run || {});
            const facts = Object.assign({}, run.facts || {});

            facts[currentStudentId] = Object.assign(
                {},
                facts[currentStudentId] || {},
                patch
            );

            saveRun({ facts });

        } catch (error) {

            // Best effort - never break the run over a note.
        }
    }


    async function processRegistration() {

        lastOverrides = 0;
        lastProceeds = 0;

        setStatus('Opening the Registration Summary...');

        await clickUntil({

            getElement: () => findSummaryButton(),
            verify: () => findProcessButton(),
            description: 'Registration Summary',
            verifyTimeout: WAIT.summary
        });

        checkStopped();

        // Whichever button was pressed last is the one whose
        // disappearance means the submit went through.
        let tracked = null;

        let processClicks = 0;
        let overrides = 0;
        let proceeds = 0;

        // Priority order, highest first:
        //
        //   1. the mandatory-courses pane, which sits on top
        //   2. Process Registration itself - an Override can
        //      show up BEFORE the submit, and answering that
        //      instead would leave the registration unsent
        //   3. Override
        //   4. the tracked button having gone away
        //
        while (true) {

            checkStopped();

            let result = null;

            try {

                result = await waitFor(
                    () => {

                        const slider = findSliderProceedButton();

                        if (slider && slider !== tracked) {
                            return { slider };
                        }

                        const main = findMainProcessButton();

                        if (
                            main &&
                            main !== tracked &&
                            processClicks < CONFIG.maxProcessClicks
                        ) {
                            return { process: main };
                        }

                        const override = findOverrideButton();

                        if (override) {
                            return { override };
                        }

                        if (!tracked) {
                            return null;
                        }

                        return (
                            !tracked.isConnected ||
                            !isVisible(tracked) ||
                            tracked.disabled
                        )
                            ? { done: true }
                            : null;

                    },
                    processClicks
                        ? WAIT.processResult
                        : WAIT.summary,
                    tracked
                        ? 'the registration to process'
                        : 'the Process Registration button'
                );

            } catch (error) {

                if (!processClicks && !proceeds) {

                    throw new Error(
                        'Process Registration was never pressed.'
                    );
                }

                await sleep(DELAY.afterProcess);

                setStatus(
                    '⚠ Process Registration clicked but no ' +
                    'confirmation was seen.'
                );

                return 'Process clicked - unconfirmed' +
                    describeDialogs(overrides, proceeds);
            }

            if (result.done) {
                break;
            }

            // ---- Mandatory courses pane ----

            if (result.slider) {

                if (proceeds >= CONFIG.maxOverrides) {

                    return (
                        'Stopped - mandatory courses pane kept ' +
                        'reappearing - check this student'
                    );
                }

                proceeds++;
                lastProceeds = proceeds;

                recordFact({
                    proceeds,
                    credits: readReservedHours()
                });

                setStatus(
                    'Mandatory courses pane - clicking Proceed (' +
                    proceeds +
                    ')...'
                );

                tracked = result.slider;

                await realMouseClick(result.slider);

                await sleep(DELAY.afterOverride);

                continue;
            }

            // ---- Process Registration ----

            if (result.process) {

                processClicks++;

                recordFact({ credits: readReservedHours() });

                setStatus(
                    processClicks > 1
                        ? 'Pressing Process Registration again (' +
                          processClicks + ')...'
                        : 'Processing the registration...'
                );

                tracked = result.process;

                await realMouseClick(result.process);

                await sleep(DELAY.afterOverride);

                continue;
            }

            // ---- Override ----

            if (overrides >= CONFIG.maxOverrides) {

                setStatus(
                    '⚠ Override appeared more than ' +
                    CONFIG.maxOverrides +
                    ' times - stopping here.'
                );

                return (
                    'Stopped after ' +
                    overrides +
                    ' override(s) - check this student'
                );
            }

            overrides++;
            lastOverrides = overrides;

            recordFact({
                overrides,
                credits: readReservedHours()
            });

            setStatus(
                'Override dialog - clicking Override (' +
                overrides +
                ')...'
            );

            await realMouseClick(result.override);

            await sleep(DELAY.afterOverride);

            // Round again: the Process Registration button may
            // now be waiting to be pressed, another dialog may
            // follow, or the registration may be through.
        }

        await sleep(DELAY.afterProcess);

        const detail = describeDialogs(overrides, proceeds);

        setStatus('✓ Registration processed' + detail + '.');

        return 'Processed' + detail;
    }


    function describeDialogs(overrides, proceeds) {

        const parts = [];

        if (proceeds) {
            parts.push(proceeds + ' proceed');
        }

        if (overrides) {
            parts.push(overrides + ' override');
        }

        return parts.length
            ? ' (' + parts.join(', ') + ')'
            : '';
    }


    // =========================================================
    // CONFIRM THE PROCESSED CHANGES
    //
    // Processing ends with an OK dialog confirming what was
    // done. It has to be cleared before the menu can be used
    // to get back to the SAR search.
    // =========================================================

    // Matched on the label only. The account Save button also
    // carries data-allow-saveandcontinue, and that is not
    // this button.
    function findSaveAndContinueButton() {

        return [
            ...document.querySelectorAll('button')
        ].filter(isVisible).find(
            button => {

                const text = normalise(button.textContent);

                return (
                    text === 'save and continue' ||
                    text === 'save & continue' ||
                    text === 'saveandcontinue'
                );
            }
        ) || null;
    }


    async function confirmProcessedChanges() {

        const pressed = [];

        // Either dialog can follow the other, so keep clearing
        // whatever is on screen until nothing is left.
        for (let round = 1; round <= CONFIG.maxConfirmRounds; round++) {

            checkStopped();

            let found = null;

            try {

                found = await waitFor(
                    () => {

                        const saveContinue =
                            findSaveAndContinueButton();

                        if (saveContinue) {
                            return {
                                button: saveContinue,
                                label: 'Save and Continue'
                            };
                        }

                        const ok = findOkButton();

                        return ok
                            ? { button: ok, label: 'OK' }
                            : null;

                    },
                    round === 1 ? WAIT.finalOk : WAIT.okButton,
                    'a confirmation dialog'
                );

            } catch (error) {

                // Nothing left to clear.
                break;
            }

            setStatus('Clicking ' + found.label + '...');

            await realMouseClick(found.button);

            pressed.push(found.label);

            try {

                await waitFor(
                    () => (
                        !found.button.isConnected ||
                        !isVisible(found.button)
                    ) ? true : null,
                    WAIT.okButton,
                    'the dialog to close'
                );

            } catch (error) {

                setStatus(
                    '⚠ ' +
                    found.label +
                    ' clicked but the dialog did not close.'
                );

                await sleep(DELAY.afterOverride);

                return pressed.join(' + ') + ' - dialog still open';
            }

            await sleep(DELAY.afterOverride);
        }

        if (!pressed.length) {
            return 'no dialog';
        }

        setStatus('✓ Changes confirmed.');

        return pressed.join(' + ') + ' pressed';
    }


    // =========================================================
    // PROCESS ONE STUDENT
    // =========================================================

    async function processStudent(studentId, request) {

        const method = request.paymentMethod;

        currentStudentId = studentId;

        recordFact({ studentId, started: true });

        setStatus('Processing student ' + studentId);

        await searchStudent(studentId);

        await openStudentRecord(studentId);

        // Everything a skipped student needs: a note, the
        // saved position moved on, and back to the search.
        const skipStudent = async reason => {

            setStatus(
                'Student ' +
                studentId +
                ' skipped - ' +
                reason +
                '.\n\nMoving to the next student.'
            );

            recordFact({
                status: 'SKIPPED - ' + reason,
                credits: null
            });

            markStage(studentId, 'processed');
            advanceRun(studentId);

            await sleep(2000);

            await returnToSAR();

            return {
                analysis: { report: [] },
                paymentStatus: 'not touched',
                standardOutcomes: [],
                skipped: [],
                processStatus: 'SKIPPED - ' + reason,
                credits: null,
                overrides: 0,
                proceeds: 0,
                report: [
                    'Student ' + studentId + ' skipped - ' + reason
                ]
            };
        };

        // ---- Finance hold ----

        if (CONFIG.skipOnFinanceHold && findHoldIcon()) {

            return await skipStudent('FINANCE HOLD on the record');
        }

        // ---- Only enrol if ready for enrolment ----

        if (CONFIG.onlyIfReady) {

            const status = await readEnrolmentStatus();

            if (!isReadyForEnrolment(status)) {

                const reason = status
                    ? (isAlreadyEnrolled(status)
                        ? 'already "' + status + '"'
                        : 'status is "' + status + '"')
                    : 'the Enrolment Status could not be read';

                return await skipStudent(reason);
            }

            setStatus(
                'Enrolment Status: ' + status + ' - carrying on.'
            );
        }

        // ---- Level of study ----

        const levelOfStudy = findLevelOfStudyText();

        const yearOne =
            CONFIG.skipStandingForYearOne && isYearOne(levelOfStudy);

        if (levelOfStudy) {

            setStatus('Level of Study: ' + levelOfStudy);
        }

        recordFact({ level: levelOfStudy || 'unreadable' });

        // ---- Enrolment standing for the year ----

        let standingNote = yearOne
            ? 'not checked - Year 1'
            : 'not checked';

        if (yearOne) {

            recordFact({ standing: 'not checked - Year 1' });

            setStatus(
                'Level of Study is "' +
                levelOfStudy +
                '" - no previous year to sign off, so the ' +
                CONFIG.standingYear +
                ' standing is not checked.'
            );

            await sleep(1500);
        }

        if (CONFIG.requireEnrolmentStanding && !yearOne) {

            const standing =
                await readEnrolmentStanding(CONFIG.standingYear);

            // No row for that year at all is not a problem:
            // there is nothing to sign off yet, so carry on
            // and enrol them. Only a row that EXISTS with an
            // empty standing stops the student.
            if (standing.missing) {

                const seen = standing.rows
                    .map(row => row.period || '(no period)')
                    .join(', ');

                standingNote =
                    'no ' +
                    CONFIG.standingYear +
                    ' row' +
                    (seen ? ' (rows: ' + seen + ')' : '') +
                    ' - carrying on';

                recordFact({ standing: 'no ' + CONFIG.standingYear + ' row' });

                setStatus(
                    'No ' +
                    CONFIG.standingYear +
                    ' enrolment row' +
                    (seen ? ' (found: ' + seen + ')' : '') +
                    '.\n\nNothing to sign off - carrying on.'
                );

                await sleep(1500);

            } else {

                const value = standing.row.text || standing.row.id;

                if (!value) {

                    // Flagged separately on the report card:
                    // these are the ones to go and look at.
                    recordFact({
                        noStanding: true,
                        standing: 'empty',
                        level: levelOfStudy || 'unreadable'
                    });

                    return await skipStudent(
                        CONFIG.standingYear +
                        ' Enrolment Standing is empty' +
                        (standing.row.status
                            ? ' (status "' + standing.row.status + '")'
                            : '')
                    );
                }

                standingNote = value;

                recordFact({ standing: value });

                setStatus(
                    CONFIG.standingYear +
                    ' Enrolment Standing: ' +
                    value +
                    ' - carrying on.'
                );
            }
        }

        let paymentStatus = 'Not changed (dry run)';
        let standardOutcomes = [];
        let processStatus = 'Not processed (dry run)';

        // ---- Financial account ----

        if (!CONFIG.dryRun) {

            try {

                paymentStatus = await applyPaymentMethod(method);

            } catch (error) {

                // Nothing has been registered yet, so this
                // student can safely be run again from the top.
                error.retryable = true;

                throw error;
            }
        }

        markStage(studentId, 'payment-done');

        // ---- Registration ----

        await openRegistration();

        await selectAcademicYear();

        // Tick Check Required BEFORE anything is opened, so
        // the list only carries what the degree requires.
        let checkRequiredStatus = 'skipped';

        if (CONFIG.checkRequired && !CONFIG.dryRun) {
            checkRequiredStatus = await ensureCheckRequired();
        }

        // ---- Reserved hours ----
        //
        // Well over a full year's worth already reserved means
        // the modules are on: no need to open anything.
        const reservedHours = readReservedHours();

        let creditsAtProcessing = reservedHours;
        let overridesUsed = 0;
        let proceedsUsed = 0;
        let multiOptionModules = [];

        recordFact({ credits: reservedHours });

        if (reservedHours === null) {

            setStatus(
                'Reserved credits could not be read - opening ' +
                'the blocks as normal.'
            );
        }

        // Exactly 0 credits: enrol. Anything else: the
        // modules are already reserved, so skip straight to
        // registering them.
        let alreadyEnrolled =
            reservedHours !== null &&
            reservedHours > CONFIG.maxReservedHours;

        if (alreadyEnrolled) {

            setStatus(
                reservedHours +
                ' credit(s) already reserved.\n\nThe modules ' +
                'are on, so the blocks are not opened - going ' +
                'straight to the Registration Summary.'
            );

            await sleep(2000);
        }

        const blocks = alreadyEnrolled
            ? []
            : await expandAllSummaryBlocks();

        const analysis = analyseBlocks(blocks);

        // A long list even after the tick usually means this
        // student is already enrolled. The sidebar settles it.
        let alreadySelected = 0;

        const requiredBlocks = analysis.results.filter(
            result => result.required
        ).length;

        if (!alreadyEnrolled && requiredBlocks > CONFIG.manyBlocks) {

            alreadySelected = await countAlreadySelected();

            alreadyEnrolled =
                alreadySelected > CONFIG.alreadySelected;

            setStatus(
                requiredBlocks +
                ' required blocks listed and ' +
                alreadySelected +
                ' course(s) already selected.\n\n' +
                (alreadyEnrolled
                    ? 'Treating this student as already enrolled - ' +
                      'going straight to the Registration Summary.'
                    : 'Carrying on and enrolling as normal.')
            );

            await sleep(2000);
        }

        if (CONFIG.dryRun) {

            const preview = analysis.results
                .filter(result => result.required)
                .map(
                    result =>
                        'Would click Standard on ' +
                        result.co +
                        (result.count === 1 && result.codes.length === 1
                            ? ''
                            : ' (SKIPPED - ' +
                              result.count +
                              ' sections)')
                );

            setStatus(
                'DRY RUN - nothing clicked, saved or processed.\n\n' +
                'Payment method would be: ' + method + '\n\n' +
                analysis.report.join('\n') +
                (preview.length ? '\n\n' + preview.join('\n') : '')
            );

        } else {

            if (!alreadyEnrolled) {

                standardOutcomes =
                    await clickStandardForRequired(analysis);
            }

            // The credits sitting on the record at the moment
            // it is submitted - what the report card shows.
            creditsAtProcessing =
                readReservedHours() !== null
                    ? readReservedHours()
                    : reservedHours;

            multiOptionModules = standardOutcomes.filter(
                outcome => outcome.multiOption
            );

            if (multiOptionModules.length) {

                // At least one required block has more than
                // one Standard button - which one to pick is
                // not this script's call to make. Everything
                // else that WAS reservable above has already
                // been clicked; Process Registration is simply
                // never pressed, so nothing is committed for
                // this student and a human can finish the
                // choice and submit it themselves.
                processStatus =
                    'NOT PROCESSED - ' +
                    multiOptionModules.length +
                    ' option module(s) need a manual choice (' +
                    multiOptionModules.map(m => m.co).join(', ') +
                    ')';

                recordFact({
                    status: processStatus,
                    multiOption: multiOptionModules.map(
                        module => ({
                            co: module.co,
                            sections: module.sections || []
                        })
                    )
                });

                markStage(studentId, 'processed');
                advanceRun(studentId);

                // Nothing was submitted, so there is no
                // confirmation dialog to clear.

            } else {

                processStatus = await processRegistration();

                overridesUsed = lastOverrides;
                proceedsUsed = lastProceeds;

                // The submit has gone through. If the page
                // reloads from here on - pressing OK often
                // does - the resume must move to the NEXT
                // student rather than running this one again.
                recordFact({
                    status: processStatus,
                    overrides: lastOverrides,
                    proceeds: lastProceeds
                });

                markStage(studentId, 'processed');

                // Advance the saved position immediately: the
                // next student is the next LINE of the box,
                // and a reload from here must not repeat this
                // one.
                advanceRun(studentId);

                // Clear the confirmation dialog before
                // touching the menu to return to the SAR
                // search.
                const confirmed = await confirmProcessedChanges();

                if (confirmed !== 'no dialog') {
                    processStatus += ' - ' + confirmed;
                }
            }
        }

        // ---- Report ----

        const lines = analysis.report.slice();

        lines.push('');
        lines.push('Payment method: ' + method + ' → ' + paymentStatus);
        lines.push(
            'Level of Study: ' + (levelOfStudy || 'could not be read')
        );
        lines.push(
            CONFIG.standingYear + ' standing: ' + standingNote
        );
        lines.push('Check Required: ' + checkRequiredStatus);

        lines.push(
            'Reserved credits: ' +
            (reservedHours === null ? 'could not be read' : reservedHours) +
            (alreadyEnrolled
                ? ' - already reserved, blocks NOT opened'
                : '')
        );

        if (alreadySelected) {

            lines.push(
                'Selected Courses sidebar: ' +
                alreadySelected +
                ' course(s)' +
                (alreadyEnrolled
                    ? ' - already enrolled, Standard was NOT clicked'
                    : '')
            );
        }

        if (standardOutcomes.length) {

            lines.push('');
            lines.push('REQUIRED BY DEGREE BLOCKS');
            lines.push('=========================');

            for (const outcome of standardOutcomes) {
                lines.push(outcome.co + ' → ' + outcome.status);
            }
        }

        const skipped = standardOutcomes.filter(
            outcome => outcome.status.startsWith('SKIPPED')
        );

        if (skipped.length) {

            lines.push('');
            lines.push(
                '⚠ ' +
                skipped.length +
                ' required block(s) were NOT enrolled' +
                (multiOptionModules.length
                    ? ' - registration was NOT processed:'
                    : ' and the registration was processed ' +
                      'without them:')
            );

            for (const outcome of skipped) {
                lines.push('    ' + outcome.co);
            }
        }

        if (multiOptionModules.length) {

            lines.push('');
            lines.push(
                '⚠ MULTI-SELECTION MODULE(S) - registration NOT processed:'
            );

            for (const module of multiOptionModules) {

                lines.push(
                    '    ' +
                    module.co +
                    ' (' +
                    (module.sections || []).join(' / ') +
                    ')'
                );
            }
        }

        lines.push('');
        lines.push('Registration: ' + processStatus);



        setStatus(
            '✓ STUDENT COMPLETE\n\n' +
            'Student: ' + studentId + '\n\n' +
            lines.join('\n')
        );

        // Give the page time to finish before navigating, so
        // the return to SAR has something stable to work with.
        const settle = CONFIG.dryRun ? 1000 : DELAY.beforeReturn;

        if (settle >= 3000) {

            setStatus(
                'Student ' +
                studentId +
                ' done - waiting ' +
                Math.round(settle / 1000) +
                's before returning to the search...'
            );
        }

        await sleep(settle);

        await returnToSAR();

        return {
            analysis,
            paymentStatus,
            standardOutcomes,
            skipped,
            processStatus,
            credits: creditsAtProcessing,
            overrides: overridesUsed,
            proceeds: proceedsUsed,
            multiOptionModules,
            report: lines
        };
    }


    // =========================================================
    // BATCH STATE
    //
    // TSM reloads the page under the script at times - after
    // the final OK in particular - which wipes the panel and
    // leaves it reading "Ready". The run is kept in the
    // browser so it can be picked up where it left off.
    // =========================================================

    function saveRun(patch) {

        try {

            const saved = loadSettings();

            const run = Object.assign(
                {},
                saved.run || {},
                patch,
                {
                    savedAt: Date.now(),
                    origin: window.location.origin,
                    tabId: TAB_ID
                }
            );

            saveSetting('run', run);

            return run;

        } catch (error) {

            return null;
        }
    }


    function loadRun() {

        const run = (loadSettings() || {}).run;

        if (!run || !run.running) {
            return null;
        }

        if (run.origin !== window.location.origin) {
            return null;
        }

        // A tab opened from a link inherits a copy of
        // sessionStorage, so never resume another tab's run.
        if (run.tabId && run.tabId !== TAB_ID) {
            return null;
        }

        const age = Date.now() - (run.savedAt || 0);

        if (age > CONFIG.resumeWindowMinutes * 60 * 1000) {
            return null;
        }

        if (
            !Array.isArray(run.studentIds) ||
            !run.studentIds.length
        ) {
            return null;
        }

        return run;
    }


    function endRun() {
        saveRun({ running: false });
    }


    // The card is shown, and then TSM reloads the page and the
    // panel comes back reading "Ready" with the card gone. So
    // it is kept and put back on the next load.
    function saveReport(text) {

        try {

            saveSetting('lastReport', {
                text: String(text || ''),
                at: Date.now()
            });

        } catch (error) {

            // Best effort.
        }
    }


    function loadReport() {

        const report = (loadSettings() || {}).lastReport;

        if (!report || !report.text) {
            return null;
        }

        const age = Date.now() - (report.at || 0);

        // Anything older than a few hours is history.
        if (age > 6 * 60 * 60 * 1000) {
            return null;
        }

        return report;
    }


    function showReport(text, at) {

        const when = at
            ? new Date(at).toLocaleTimeString()
            : '';

        setStatus(
            (when ? 'Last batch report (' + when + ')\n\n' : '') +
            text
        );
    }


    function markStage(studentId, stage) {
        saveRun({ current: { studentId, stage } });
    }


    // Move the saved position on to the next line of the
    // Student IDs box.
    function advanceRun(studentId) {

        try {

            const run = (loadSettings() || {}).run;

            if (!run || !Array.isArray(run.studentIds)) {
                return;
            }

            const at = run.studentIds.indexOf(studentId);

            if (at < 0) {
                return;
            }

            saveRun({
                index: at + 1,
                current: { studentId, stage: 'processed' }
            });

        } catch (error) {

            // Position tracking is best effort.
        }
    }


    // =========================================================
    // PROCESS BATCH
    // =========================================================

    async function processBatch(studentIds, request, startIndex) {

        if (!studentIds.length) {
            throw new Error('No Student IDs entered.');
        }

        stopped = false;
        processing = true;

        // Results are kept in the saved run as well as in
        // memory: TSM reloads the page under the script, and
        // without this the report card would only ever cover
        // the students processed since the last reload.
        const prior = (loadSettings().run || {}).results;

        const results =
            (startIndex && Array.isArray(prior))
                ? prior.slice()
                : [];

        try {

            for (
                let index = startIndex || 0;
                index < studentIds.length;
                index++
            ) {

                checkStopped();

                const studentId = studentIds[index];

                saveRun({
                    running: true,
                    studentIds,
                    index,
                    paymentMethod: request.paymentMethod,
                    current: { studentId, stage: 'started' }
                });

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
                        await runStudentWithRetries(
                            studentId,
                            request
                        );

                    const clicked = outcome.standardOutcomes.filter(
                        item => wasClicked(item.status)
                    ).length;

                    results.push({
                        studentId,
                        status: outcome.processStatus,
                        payment: outcome.paymentStatus,
                        skipped: outcome.skipped.length,
                        credits: outcome.credits,
                        overrides: outcome.overrides,
                        proceeds: outcome.proceeds,
                        multiOption: (outcome.multiOptionModules || []).map(
                            module => ({
                                co: module.co,
                                sections: module.sections || []
                            })
                        ),
                        incomplete:
                            outcome.skipped.length > 0 ||
                            /unconfirmed|Stopped|still dirty/i
                                .test(outcome.processStatus || ''),
                        clicked
                    });

                    saveRun({ results });

                } catch (error) {

                    console.error('TSM batch error:', error);

                    results.push({
                        studentId,
                        status: 'ERROR: ' + error.message,
                        payment: '-',
                        skipped: 0,
                        credits: null,
                        overrides: 0,
                        proceeds: 0,
                        incomplete: true,
                        error: true,
                        clicked: 0
                    });

                    saveRun({ results });

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

            const card = safeReportCard(results, true, studentIds);

            saveReport(card);

            setStatus(card);

        } catch (error) {

            setStatus(
                'BATCH ENDED\n\n' +
                error.message +
                '\n\n' +
                safeReportCard(results, false, studentIds),
                true
            );

            saveReport(
                'BATCH ENDED\n\n' +
                error.message +
                '\n\n' +
                safeReportCard(results, false, studentIds)
            );

        } finally {

            processing = false;

            endRun();

            const button =
                document.getElementById('tsm-start-batch');

            if (button) {
                button.disabled = false;
            }
        }
    }


    // =========================================================
    // REPORT CARD
    //
    // One line per student: whether Override was pressed, the
    // credits they were carrying when it was, and anything
    // that did not finish cleanly.
    // =========================================================

    // A plain list, used if anything in the card itself goes
    // wrong. The report is the whole point of the run, so it
    // must never be lost to a formatting bug.
    function plainReport(results, complete) {

        return (
            (complete ? '✓ BATCH COMPLETE' : 'BATCH ENDED EARLY') +
            '\n\n' +
            (results || []).map(
                result =>
                    result.studentId + ' — ' + result.status
            ).join('\n')
        );
    }


    function safeReportCard(results, complete, studentIds) {

        try {

            return buildReportCard(results, complete, studentIds);

        } catch (error) {

            console.error('TSM report card failed:', error);

            return (
                plainReport(results, complete) +
                '\n\n(The full report card could not be built: ' +
                error.message + ')'
            );
        }
    }


    function buildReportCard(results, complete, studentIds) {

        const run = loadSettings().run || {};
        const facts = run.facts || {};

        const ids = Array.isArray(studentIds) && studentIds.length
            ? studentIds
            : (Array.isArray(run.studentIds) ? run.studentIds : []);

        // Every student on the list gets a line, whether their
        // result made it back or the page reloaded first.
        const rows = (
            ids.length
                ? ids
                : results.map(result => result.studentId)
        ).map(
            studentId => {

                const result =
                    results.find(
                        item => String(item.studentId) === String(studentId)
                    ) || {};

                const noted = facts[studentId] || {};

                const overrides =
                    result.overrides || noted.overrides || 0;

                const credits =
                    (result.credits !== undefined &&
                     result.credits !== null)
                        ? result.credits
                        : (noted.credits === undefined
                            ? null
                            : noted.credits);

                const status =
                    result.status ||
                    noted.status ||
                    (noted.started
                        ? 'INCOMPLETE - no result recorded'
                        : 'not reached');

                const multiOption =
                    (result.multiOption && result.multiOption.length)
                        ? result.multiOption
                        : (Array.isArray(noted.multiOption)
                            ? noted.multiOption
                            : []);

                return {
                    studentId,
                    status,
                    credits,
                    overrides,
                    level: noted.level || '',
                    standing: noted.standing || '',
                    noStanding:
                        !!noted.noStanding ||
                        /enrolment standing is empty/i.test(status),
                    multiOption,
                    proceeds: result.proceeds || noted.proceeds || 0,
                    skipped: result.skipped || 0,
                    error:
                        !!result.error ||
                        /^ERROR/i.test(status),
                    incomplete:
                        !!result.incomplete ||
                        /INCOMPLETE|unconfirmed|Stopped|still dirty/i
                            .test(status)
                };
            }
        );

        const lines = [];

        lines.push(
            complete ? '✓ BATCH COMPLETE' : 'BATCH ENDED EARLY'
        );

        lines.push('');
        lines.push('REPORT CARD');
        lines.push('===========');
        lines.push('');

        for (const row of rows) {

            const bits = [];

            bits.push(row.studentId);

            bits.push(
                'credits: ' +
                (row.credits === null ? 'unknown' : row.credits)
            );

            bits.push(
                row.overrides
                    ? 'OVERRIDE ×' + row.overrides
                    : 'override: no'
            );

            if (row.proceeds) {
                bits.push('proceed ×' + row.proceeds);
            }

            bits.push(row.status);

            if (row.noStanding && row.level) {
                bits.push('Level of Study: ' + row.level);
            }

            if (row.skipped) {
                bits.push('⚠ ' + row.skipped + ' block(s) skipped');
            }

            if (row.multiOption.length) {

                bits.push(
                    '⚠ multi-selection: ' +
                    row.multiOption.map(m => m.co).join(', ')
                );
            }

            lines.push(bits.join(' — '));
        }

        const errors = rows.filter(row => row.error);

        const incomplete = rows.filter(
            row => row.incomplete && !row.error
        );

        const overridden = rows.filter(row => row.overrides);

        // Declared with the others: the totals below read it,
        // and a const declared further down threw a TDZ error
        // that swallowed the whole report card.
        const noStanding = rows.filter(row => row.noStanding);

        lines.push('');
        lines.push('TOTALS');
        lines.push('======');
        const multiSelection = rows.filter(
            row => row.multiOption.length
        );

        lines.push('Students        : ' + rows.length);
        lines.push('Overrides used  : ' + overridden.length);
        lines.push('No standing     : ' + noStanding.length);
        lines.push('Multi-selection : ' + multiSelection.length);
        lines.push('Errors          : ' + errors.length);
        lines.push('Incomplete      : ' + incomplete.length);

        if (overridden.length) {

            lines.push('');
            lines.push('OVERRIDE PRESSED');
            lines.push('================');

            for (const row of overridden) {

                lines.push(
                    row.studentId +
                    ' — ×' +
                    row.overrides +
                    ' — credits: ' +
                    (row.credits === null ? 'unknown' : row.credits)
                );
            }
        }

        if (noStanding.length) {

            lines.push('');
            lines.push('NO ENROLMENT STANDING - NOT ENROLLED');
            lines.push('====================================');

            for (const row of noStanding) {

                lines.push(
                    row.studentId +
                    ' — ' +
                    (row.level
                        ? 'Level of Study: ' + row.level
                        : 'level unknown') +
                    ' — ' +
                    row.status
                );
            }
        }

        if (multiSelection.length) {

            lines.push('');
            lines.push('MULTI-SELECTION MODULES - NOT PROCESSED');
            lines.push('========================================');

            for (const row of multiSelection) {

                lines.push('');
                lines.push(row.studentId + ':');

                for (const module of row.multiOption) {

                    lines.push(
                        '    ' +
                        module.co +
                        ' — ' +
                        (module.sections && module.sections.length
                            ? module.sections.join(' / ')
                            : (module.sections
                                ? module.sections.length + ' section(s)'
                                : 'sections unknown'))
                    );
                }
            }
        }

        if (errors.length || incomplete.length) {

            lines.push('');
            lines.push('NEEDS ATTENTION');
            lines.push('===============');

            for (const row of errors.concat(incomplete)) {
                lines.push(row.studentId + ' — ' + row.status);
            }
        }

        console.table(rows);

        return lines.join('\n');
    }


    // =========================================================
    // ONE STUDENT, WITH RETRIES
    //
    // Anything that failed because something did not appear
    // in time is tried again from the top with every delay
    // and timeout stretched a further 5%, up to +25%. Past
    // that the student is left for the report card.
    // =========================================================

    async function runStudentWithRetries(studentId, request) {

        let extra = 0;

        while (true) {

            try {

                const outcome =
                    await processStudent(studentId, request);

                applySlowdown(1);

                return outcome;

            } catch (error) {

                checkStopped();

                const worthRetrying =
                    error.retryable || isTimeoutError(error);

                const room =
                    extra + CONFIG.slowdownStep <=
                    CONFIG.slowdownMax + 0.0001;

                if (!worthRetrying || !room) {

                    const attempts = Math.round(
                        extra / CONFIG.slowdownStep
                    );

                    if (attempts) {

                        error.message +=
                            ' (gave up after ' +
                            attempts +
                            ' retries, delays up to ' +
                            slowdownLabel() +
                            ')';
                    }

                    applySlowdown(1);

                    throw error;
                }

                extra = Math.round(
                    (extra + CONFIG.slowdownStep) * 100
                ) / 100;

                applySlowdown(1 + extra);

                console.error('TSM retry:', error);

                setStatus(
                    'Student ' +
                    studentId +
                    ' timed out:\n\n' +
                    error.message +
                    '\n\nTrying again with every delay ' +
                    slowdownLabel() +
                    ' longer...'
                );

                try {

                    await returnToSAR();

                } catch (recoveryError) {

                    applySlowdown(1);

                    throw error;
                }
            }
        }
    }


    // =========================================================
    // USER INTERFACE
    // =========================================================

    const PAYMENT_METHODS = [
        'Undergraduate & PGCE',
        'One',
        'Employer',
        'Other'
    ];


    // The panel is rebuilt whenever TSM redraws the page, so
    // what was typed is kept in the browser and put back.
    // Three channels, in order of trust:
    //
    //   1. window.name - carries the DATA itself (not just an
    //      id). This is what actually fixes reload data loss:
    //      window.name is guaranteed by the browser to survive
    //      every kind of same-tab navigation, including a full
    //      server reload/redirect, and unlike storage it is
    //      never re-scoped by a change of origin. TSM's own
    //      "page reloads under the script" behaviour is
    //      exactly the case this channel is built for.
    //   2. sessionStorage - per tab, the normal case.
    //   3. localStorage - shared across tabs on the site, kept
    //      only as a last-resort backup and always written
    //      under a tab-specific key so it can never leak
    //      between tabs.
    //
    // Every save writes all three; every load reads whichever
    // has the newest content, window.name first.
    const STORAGE_KEY = 'tsm-payment-assistant';

    const NAME_PREFIX = 'tsm-data:' + STORAGE_KEY + ':';


    function readWindowNamePayload() {

        try {

            const named = String(window.name || '');

            if (!named.startsWith(NAME_PREFIX)) {
                return null;
            }

            const payload = JSON.parse(
                named.slice(NAME_PREFIX.length)
            );

            return (payload && typeof payload === 'object')
                ? payload
                : null;

        } catch (error) {

            return null;
        }
    }


    function writeWindowNamePayload(tabId, settings) {

        try {

            window.name =
                NAME_PREFIX +
                JSON.stringify({ tabId, settings, at: Date.now() });

        } catch (error) {

            // window.name can be write-protected in rare
            // embedded contexts - the other two channels cover it.
        }
    }


    // The tab's identity. Recovered from window.name first (the
    // most durable of the three channels), then sessionStorage,
    // and only generated fresh if neither has one yet.
    const TAB_ID = (function () {

        const fresh = () => Math.random().toString(36).slice(2, 6);

        const fromName = readWindowNamePayload();

        if (fromName && fromName.tabId) {
            return fromName.tabId;
        }

        let id = '';

        try {
            id = window.sessionStorage.getItem('tsm-tab-id') || '';
        } catch (error) {}

        return id || fresh();
    })();


    try {
        window.sessionStorage.setItem('tsm-tab-id', TAB_ID);
    } catch (error) {}


    // Settings live under a key unique to this tab in both
    // storage areas, so tabs never collide even when window.name
    // is unavailable.
    function tabKey() {
        return STORAGE_KEY + ':' + TAB_ID;
    }


    function readFrom(area) {

        try {

            if (!area) {
                return null;
            }

            const raw = area.getItem(tabKey());

            return raw ? JSON.parse(raw) : null;

        } catch (error) {

            return null;
        }
    }


    function loadSettings() {

        const fromName = readWindowNamePayload();

        if (
            fromName &&
            fromName.tabId === TAB_ID &&
            fromName.settings &&
            Object.keys(fromName.settings).length
        ) {
            return fromName.settings;
        }

        let session = null;
        let local = null;

        try {
            session = readFrom(window.sessionStorage);
        } catch (error) {}

        try {
            local = readFrom(window.localStorage);
        } catch (error) {}

        // Whichever has content wins; sessionStorage first,
        // since it is refreshed on every save just like
        // window.name and is less likely to have been
        // truncated by an unusual navigation.
        if (session && Object.keys(session).length) {
            return session;
        }

        return local || session || {};
    }


    function saveSetting(name, value) {

        const saved = loadSettings();

        saved[name] = value;

        const text = JSON.stringify(saved);

        try {
            window.sessionStorage.setItem(tabKey(), text);
        } catch (error) {}

        try {
            window.localStorage.setItem(tabKey(), text);
        } catch (error) {}

        writeWindowNamePayload(TAB_ID, saved);
    }


    // =========================================================
    // HIDE AND REOPEN
    //
    // The panel covers the top right of the page, which is
    // exactly where TSM puts things that sometimes need a
    // hand. Hiding leaves a small button behind, and the
    // choice is remembered for this tab.
    // =========================================================

    function reopenButton() {
        return document.getElementById('tsm-reopen');
    }


    function ensureReopenButton() {

        if (reopenButton()) {
            return reopenButton();
        }

        const button = document.createElement('button');

        button.id = 'tsm-reopen';
        button.type = 'button';
        button.textContent = 'TSM';
        button.title = 'Show the TSM assistant panel';

        Object.assign(
            button.style,
            {
                position: 'fixed',
                top: '20px',
                right: '20px',
                width: '46px',
                height: '32px',
                padding: '0',
                display: 'none',
                cursor: 'pointer',
                zIndex: '2147483647',
                background: '#151515',
                color: '#fff',
                border: '2px solid #555',
                borderRadius: '16px',
                fontFamily: 'Arial, sans-serif',
                fontSize: '11px',
                fontWeight: 'bold',
                letterSpacing: '0.5px',
                opacity: '0.75',
                boxShadow: '0 2px 8px rgba(0,0,0,0.4)'
            }
        );

        button.addEventListener('mouseenter', () => {
            button.style.opacity = '1';
        });

        button.addEventListener('mouseleave', () => {
            button.style.opacity = '0.75';
        });

        button.addEventListener('click', () => {
            setPanelHidden(false);
        });

        document.body.appendChild(button);

        return button;
    }


    function setPanelHidden(hidden, remember) {

        // querySelectorAll, not getElementById: if a second
        // panel ever exists, both have to go.
        const panels = [
            ...document.querySelectorAll('#tsm-batch-panel')
        ];

        const button = ensureReopenButton();

        for (const panel of panels) {

            if (hidden) {

                // !important so nothing on the page can put it
                // back, plus belt and braces for stubborn CSS.
                panel.style.setProperty('display', 'none', 'important');
                panel.style.setProperty('visibility', 'hidden', 'important');
                panel.style.setProperty('pointer-events', 'none', 'important');

            } else {

                panel.style.setProperty('display', 'block', 'important');
                panel.style.setProperty('visibility', 'visible', 'important');
                panel.style.setProperty('pointer-events', 'auto', 'important');
            }
        }

        button.style.setProperty(
            'display',
            hidden ? 'block' : 'none',
            'important'
        );

        // While hidden the button carries the latest status,
        // and turns green while a batch is running.
        button.style.borderColor = processing ? '#2f7d43' : '#555';

        if (remember !== false) {
            saveSetting('panelHidden', !!hidden);
        }
    }


    function createPanel() {

        if (document.getElementById('tsm-batch-panel')) {
            return;
        }

        const panel = document.createElement('div');

        panel.id = 'tsm-batch-panel';

        panel.innerHTML = `

            <div class="tsm-title">
                TSM Payment &amp; Registration
                <span class="tsm-tab">tab ${TAB_ID}</span>
            </div>

            <div class="tsm-note">
                Sets the preferred payment method, enrols every
                requiredByDegree block, then processes the
                registration - for each student in turn.
                <br><br>
                Each tab keeps its own Student IDs, so several
                tabs can run different lists at the same time.
                HIDE PANEL gets it out of the way for manual
                work - Ctrl + Shift + H toggles it too.
            </div>

            <label class="tsm-label" for="tsm-student-ids">
                Student IDs
            </label>

            <textarea
                id="tsm-student-ids"
                class="tsm-box tsm-tall"
                placeholder="One Student ID per line&#10;&#10;19937&#10;19938&#10;19939"
            ></textarea>

            <label class="tsm-label" for="tsm-payment-method">
                Preferred Payment Method
            </label>

            <select id="tsm-payment-method" class="tsm-box">
                ${PAYMENT_METHODS.map(
                    method =>
                        '<option value="' + method + '">' +
                        method +
                        '</option>'
                ).join('')}
            </select>

            <label class="tsm-check">
                <input type="checkbox" id="tsm-only-ready">
                Only enrol if ready for enrolment
            </label>

            <label class="tsm-check">
                <input type="checkbox" id="tsm-dry-run">
                Dry run - report only, click nothing
            </label>

            <button id="tsm-start-batch">
                START BATCH
            </button>

            <button id="tsm-stop">
                STOP
            </button>

            <button id="tsm-hide">
                HIDE PANEL
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
                boxShadow: '0 5px 20px rgba(0,0,0,0.5)',

                // Without this the panel can grow past the
                // bottom of the window and its buttons end up
                // out of reach.
                maxHeight: 'calc(100vh - 40px)',
                overflowY: 'auto'
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

        const tabLabel = panel.querySelector('.tsm-tab');

        if (tabLabel) {

            Object.assign(
                tabLabel.style,
                {
                    float: 'right',
                    padding: '2px 8px',
                    background: '#333',
                    border: '1px solid #666',
                    borderRadius: '10px',
                    fontSize: '11px',
                    fontWeight: 'normal',
                    letterSpacing: '0.5px'
                }
            );
        }

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

        const input = document.getElementById('tsm-student-ids');
        const methodSelect =
            document.getElementById('tsm-payment-method');

        panel.querySelectorAll('.tsm-box').forEach(
            box => {

                Object.assign(
                    box.style,
                    {
                        width: '100%',
                        boxSizing: 'border-box',
                        minHeight: box.classList.contains('tsm-tall')
                            ? '130px'
                            : (box.tagName === 'SELECT' ? '34px' : '48px'),
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

        panel.querySelectorAll('.tsm-check').forEach(
            label => {

                Object.assign(
                    label.style,
                    {
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        margin: '10px 0 6px 0',
                        fontSize: '13px',
                        cursor: 'pointer'
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

        // ---- Restore what was entered last time ----

        const saved = loadSettings();

        if (typeof saved.studentIds === 'string' && saved.studentIds.trim()) {

            input.value = saved.studentIds;

        } else if (
            saved.run &&
            Array.isArray(saved.run.studentIds) &&
            saved.run.studentIds.length
        ) {

            // Last resort: the list held by the batch itself.
            input.value = saved.run.studentIds.join('\n');
        }

        if (
            typeof saved.paymentMethod === 'string' &&
            PAYMENT_METHODS.includes(saved.paymentMethod)
        ) {
            methodSelect.value = saved.paymentMethod;
        }

        // Only start saving once the box has been filled from
        // storage. Without this, a rebuild that restored
        // nothing could persist an empty box over a good list.
        let restored = true;

        input.addEventListener('input', () => {

            if (!restored) {
                return;
            }

            const text = input.value;

            const previous = loadSettings().studentIds;

            // Never let an empty box wipe a saved list unless
            // the box was already showing that list.
            if (
                !text.trim() &&
                typeof previous === 'string' &&
                previous.trim()
            ) {

                setStatus(
                    'Student IDs box cleared. The saved list is ' +
                    'still there - reload the page to get it back, ' +
                    'or type a new list to replace it.'
                );

                return;
            }

            saveSetting('studentIds', text);
        });

        methodSelect.addEventListener('change', () => {
            saveSetting('paymentMethod', methodSelect.value);
        });

        // ---- Options ----

        const dryRun = document.getElementById('tsm-dry-run');

        dryRun.checked =
            typeof saved.dryRun === 'boolean'
                ? saved.dryRun
                : CONFIG.dryRun;

        CONFIG.dryRun = dryRun.checked;

        dryRun.addEventListener('change', () => {
            CONFIG.dryRun = dryRun.checked;
            saveSetting('dryRun', dryRun.checked);
        });

        const onlyReady = document.getElementById('tsm-only-ready');

        onlyReady.checked =
            typeof saved.onlyIfReady === 'boolean'
                ? saved.onlyIfReady
                : CONFIG.onlyIfReady;

        CONFIG.onlyIfReady = onlyReady.checked;

        onlyReady.addEventListener('change', () => {
            CONFIG.onlyIfReady = onlyReady.checked;
            saveSetting('onlyIfReady', onlyReady.checked);
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

                const paymentMethod =
                    methodSelect.value.replace(/\s+/g, ' ').trim();

                if (!paymentMethod) {

                    setStatus(
                        '⚠ Choose the preferred payment method.',
                        true
                    );

                    methodSelect.focus();

                    return;
                }

                const action = CONFIG.dryRun
                    ? 'DRY RUN - nothing will be saved or processed.'
                    : 'The account WILL be saved and the ' +
                      'registration WILL be processed.';

                const confirmation = window.confirm(
                    'START BATCH?\n\n' +
                    'Students:\n\n' +
                    studentIds.join('\n') +
                    '\n\n' +
                    'Payment method: ' + paymentMethod + '\n\n' +
                    'For each student:\n\n' +
                    '1. Open Student Academic Record\n' +
                    (CONFIG.skipOnFinanceHold
                        ? '   (skipped if a finance hold icon is\n' +
                          '    on the record)\n'
                        : '') +
                    (CONFIG.onlyIfReady
                        ? '   (skipped unless the Enrolment Status\n' +
                          '    reads "Ready for Enrolment")\n'
                        : '') +
                    (CONFIG.requireEnrolmentStanding
                        ? '   (skipped only if a ' + CONFIG.standingYear +
                          ' row\n    exists with an empty Enrolment\n' +
                          '    Standing - never for Year 1)\n'
                        : '') +
                    '2. Context Menu → Financial Accounts\n' +
                    '3. Edit → set the payment method → OK → Save\n' +
                    '4. Context Menu → Registration\n' +
                    '5. Select ' + CONFIG.academicYear + '\n' +
                    '6. Tick Check Required, then open the\n' +
                    '   requiredByDegree blocks only - and only\n' +
                    '   if the student has 0 reserved credits\n' +
                    '7. Standard on every requiredByDegree block\n' +
                    '   (skipped if the sidebar shows the student\n' +
                    '    is already enrolled)\n' +
                    '8. Registration Summary → Process Registration\n' +
                    '   (answering Proceed / Override if they\n' +
                    '    appear, then OK to confirm) - UNLESS a\n' +
                    '   required block has more than one Standard\n' +
                    '   button (an option course): those students\n' +
                    '   are left unprocessed and noted on the\n' +
                    '   report card instead\n' +
                    '9. Main Menu → Academics → SAR\n\n' +
                    action + '\n\n' +
                    'Continue?'
                );

                if (!confirmation) {
                    return;
                }

                startButton.disabled = true;

                saveSetting('lastReport', null);

                await processBatch(
                    studentIds,
                    { paymentMethod }
                );
            }
        );

        // ---- Hide ----

        const hideButton = document.getElementById('tsm-hide');

        Object.assign(
            hideButton.style,
            {
                background: '#2a2a2a',
                color: '#ddd',
                border: '1px solid #666'
            }
        );

        hideButton.addEventListener('click', () => {
            setPanelHidden(true);
        });

        ensureReopenButton();

        // Put the panel back the way this tab left it.
        setPanelHidden(saved.panelHidden === true, false);

        // Ctrl + Shift + H toggles, for when the small button
        // is sitting over something that needs clicking.
        document.addEventListener(
            'keydown',
            event => {

                if (
                    event.ctrlKey &&
                    event.shiftKey &&
                    (event.key === 'H' || event.key === 'h')
                ) {

                    event.preventDefault();

                    const panel =
                        document.getElementById('tsm-batch-panel');

                    setPanelHidden(
                        !panel || panel.style.display !== 'none'
                    );
                }
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

                endRun();

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

        // The small button doubles as the status readout while
        // the panel is hidden.
        const small = document.getElementById('tsm-reopen');

        if (small) {

            small.title =
                String(message || '').split('\n')[0] ||
                'TSM assistant';

            small.style.borderColor = error
                ? '#8c3030'
                : (processing ? '#2f7d43' : '#555');
        }

        if (!status) {
            return;
        }

        status.textContent = message;

        status.style.background = error ? '#5c1f1f' : '#292929';
    }


    // =========================================================
    // START
    // =========================================================

    // =========================================================
    // RESUME AFTER A PAGE RELOAD
    // =========================================================

    async function resumeRun(run) {

        const studentIds = run.studentIds;
        const current = run.current || {};

        let index = run.index || 0;

        // The saved index already points at the next line, but
        // if a reload beat advanceRun to it, step past the
        // student whose registration was submitted.
        if (
            current.stage === 'processed' &&
            String(studentIds[index]) === String(current.studentId)
        ) {

            setStatus(
                'Student ' +
                current.studentId +
                ' was already processed - moving to the next one...'
            );

            index++;
        }

        if (index >= studentIds.length) {

            const results = Array.isArray(run.results)
                ? run.results
                : [];

            // Built BEFORE endRun, so the recorded facts are
            // still there to merge in.
            const card = safeReportCard(results, true, studentIds);

            endRun();

            saveReport(card);

            setStatus(card);

            return;
        }

        const done = Array.isArray(run.results) ? run.results.length : 0;

        setStatus(
            'The page reloaded mid-batch.\n\n' +
            'Resuming at student ' +
            studentIds[index] +
            ' (' +
            (index + 1) +
            ' of ' +
            studentIds.length +
            ').\n\n' +
            done +
            ' student(s) already recorded - the report card at ' +
            'the end will cover all of them.'
        );

        const startButton =
            document.getElementById('tsm-start-batch');

        if (startButton) {
            startButton.disabled = true;
        }

        await sleep(DELAY.beforeResume);

        // The reload may have left the browser anywhere, so
        // make sure the search page is up first.
        try {

            if (!searchBox()) {
                await returnToSAR();
            }

        } catch (error) {

            setStatus(
                'Could not get back to the SAR search to resume.\n\n' +
                'Press START BATCH when the search page is up - ' +
                'the Student IDs are still in the box.',
                true
            );

            endRun();

            if (startButton) {
                startButton.disabled = false;
            }

            return;
        }

        await processBatch(
            studentIds,
            { paymentMethod: run.paymentMethod },
            index
        );
    }


    function start() {

        if (!isTopFrame) {
            return;
        }

        createPanel();

        console.log(
            'TSM Payment and Registration Assistant v4.1 loaded.'
        );

        const run = loadRun();

        if (run) {

            resumeRun(run);

            return;
        }

        // No batch running: if the last one finished and the
        // page has reloaded since, put its report card back
        // rather than leaving the panel reading "Ready".
        const report = loadReport();

        if (report) {
            showReport(report.text, report.at);
        }
    }


    if (document.readyState === 'loading') {

        document.addEventListener('DOMContentLoaded', start);

    } else {

        start();
    }

})();
