// ==UserScript==
// @name         TSM Person Data Check Assistant
// @namespace    Jaden-TSM
// @version      7.0
// @description  Batch TSM assistant - compares spreadsheet rows against the Person record and applies approved corrections to email, phone, term-time address, disability and emergency contacts
// @match        *://*/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================
    // SETTINGS
    // =========================================================

    const CONFIG = {
        // Report the differences without applying anything.
        dryRun: false,

        // A finance hold or an "Enrolled" status is reported
        // and you decide - nothing is skipped silently.
        checkFinanceHold: true,
        checkEnrolmentStatus: true,

        // Carry on with the next student after a failure.
        continueOnError: true,

        // The return to SAR sometimes stops short of the
        // search page. This many Back presses recover it.
        backAttempts: 3,

        // A batch left mid-flight is only resumed if it was
        // saved within this many minutes.
        resumeWindowMinutes: 30,

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
        personPage: 30000,
        enrolmentStatus: 15000,
        editForm: 15000,
        okButton: 10000,
        save: 20000,
        returnSearch: 30000,
        backStep: 8000
    };


    const DELAY = {
        typing: 40,

        // Settling time either side of the Context Menu
        beforeContextMenu: 3000,
        afterContextMenu: 3000,

        // The Person page keeps loading briefly after it
        // appears, and its tables fill in last
        beforeRead: 3000,

        // After an OK on an edit dialog
        afterDialog: 1200,

        // Save takes a while to come back
        afterSave: 8000,

        // Settling before heading back to the search, and
        // between Back presses when it stops short
        beforeReturn: 3000,
        beforeBack: 3000,
        beforeResume: 5000,

        // General
        afterOpen: 500
    };


    // Only the top frame gets a panel - an iframe copy would
    // draw a second one that Hide never touched.
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
    // OPEN PERSON FROM THE CONTEXT MENU
    // =========================================================

    const PERSON_PATH = '/Community/Person/FromPerson';


    function findPersonLink() {
        return findLinkInFlyout(PERSON_PATH, 'person');
    }


    function personPageLoaded() {

        return (
            document.querySelector('#emergencycontactTable') ||
            document.querySelector('#phonenumberTable') ||
            document.querySelector('#mailingaddressTable')
        );
    }


    async function openPerson() {

        await openContextMenu();

        setStatus('Opening the Person record...');

        await clickUntil({

            getElement: () => findPersonLink(),
            verify: personPageLoaded,
            description: 'Person page',
            verifyTimeout: WAIT.personPage,

            beforeRetry: async () => {

                try {
                    await openContextMenu();
                } catch (error) {}
            }
        });

        // The page keeps loading for a moment after it appears.
        await sleep(DELAY.beforeRead);

        setStatus('✓ Person record open.');
    }


    // =========================================================
    // RECORD FLAGS
    //
    // Read on the Student Academic Record, before the Person
    // page is opened. Neither one skips a student on its own -
    // both are put to you first.
    // =========================================================

    function findHoldIcon() {

        return [
            ...document.querySelectorAll('.icon.holdIcon')
        ].find(isVisible) || null;
    }


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

        return span ? cleanField(span.textContent) : '';
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


    // =========================================================
    // THE PASTED ROW
    //
    // One line per student, straight out of the spreadsheet:
    //
    //   student ID, first name, last name, email, phone,
    //   international (ignored), country (ignored),
    //   permanent address, term time address,
    //   emergency contact name, their address, their number,
    //   their relationship, disability Yes/No, ... everything
    //   after is ignored
    //
    // Nothing is read by counting a fixed number of columns -
    // an address can be one cell or several (a building line,
    // a town, a postcode), and a fixed offset falls apart the
    // moment any field spans more than one. Instead, each
    // field is read moving forward from the email, one at a
    // time, by what it looks like: a phone number, a run of
    // cells ending in a UK postcode, a relationship word, a
    // Yes/No. An address simply keeps consuming cells until it
    // hits its postcode (or the next field plainly starts).
    // =========================================================

    const RELATIONSHIPS = [
        { match: /\b(parent|mother|father|mum|dad|guardian)\b/i,
          value: 'Family Member or Next of Kin - Parent' },
        { match: /\b(partner|spouse|husband|wife)\b/i,
          value: 'Partner' },
        { match: /\b(sibling|brother|sister)\b/i,
          value: 'Sibling' },
        { match: /\b(trusted|friend|colleague)\b/i,
          value: 'Trusted' }
    ];


    // Anything else, including blank, is treated as Trusted.
    function relationshipFor(text) {

        const found = RELATIONSHIPS.find(
            entry => entry.match.test(String(text || ''))
        );

        return found ? found.value : 'Trusted';
    }


    function looksLikeRelationship(value) {

        const text = normalise(value);

        if (!text || text.length > 40) {
            return false;
        }

        return (
            RELATIONSHIPS.some(entry => entry.match.test(text)) ||
            /\b(next of kin|other|unknown)\b/.test(text)
        );
    }


    function cleanField(value) {

        return String(value || '')
            .replace(/^\s*"+|"+\s*$/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }


    // Two different pastes land here. Excel's own TSV copy
    // puts a cell that contains a line break in QUOTES, with a
    // real newline inside it. A paste typed or rebuilt by hand
    // instead puts every cell on its own line with no quotes
    // and often no tabs at all - an address becomes two or
    // three plain lines in a row, and a blank line appears
    // wherever a cell was empty.
    //
    // Either way, this puts one student on one line, with
    // every cell still its own field: quoted line breaks are
    // folded into a space (still one cell), while a genuine
    // line break between cells becomes a TAB (a new cell),
    // never a space (which would run two cells into one word
    // salad with no boundary left to find). Blank lines are
    // just gaps between cells and carry nothing of their own,
    // so they are dropped rather than kept as empty fields.
    function tidyRows(text) {

        const source = String(text || '').replace(/\r\n?/g, '\n');

        // 1. Newlines inside quotes are part of the same cell.
        let flattened = '';
        let inQuotes = false;

        for (const character of source) {

            if (character === '"') {
                inQuotes = !inQuotes;
                flattened += character;
                continue;
            }

            flattened += (character === '\n' && inQuotes)
                ? ' '
                : character;
        }

        // 2. Everything from one student ID up to (but not
        //    including) the next is one row. A line that does
        //    not start a new row is another cell of the row
        //    above it - joined with a TAB, so it stays a field
        //    of its own instead of being merged into the text
        //    next to it.
        const rows = [];

        for (const raw of flattened.split('\n')) {

            const line = raw.replace(/[ \t]+$/, '');

            if (!line.trim()) {
                continue;
            }

            const startsWithId = /^\s*\d{4,9}(\t|\s|$)/.test(line);

            if (startsWithId || !rows.length) {

                rows.push(line.replace(/^\s+/, ''));

            } else {

                rows[rows.length - 1] += '\t' + line.trim();
            }
        }

        return rows.join('\n');
    }


    function splitFields(line) {

        // Excel copies as tab separated, which keeps empty
        // cells. Runs of spaces are a lossy fallback.
        const parts = line.includes('\t')
            ? line.split('\t')
            : line.split(/\s{2,}/);

        return parts.map(cleanField);
    }


    function looksLikePhone(value) {

        const text = String(value || '').trim();

        if (!text || !/^[0-9+()\s-]+$/.test(text)) {
            return false;
        }

        const digits = text.replace(/\D/g, '');

        return digits.length >= 9 && digits.length <= 15;
    }


    function parseRecord(line) {

        const f = splitFields(line);

        const record = {
            fieldCount: f.length,
            tabbed: line.includes('\t'),
            raw: f,
            problems: [],
            studentId: f[0] || '',
            firstName: '',
            lastName: '',
            email: '',
            phone: '',
            permanentAddress: '',
            termAddress: '',
            ecName: '',
            ecAddress: '',
            ecNumber: '',
            relationship: '',
            relationshipValue: 'Trusted',
            disability: '',
            hasDisability: false
        };

        const emailIndex = f.findIndex(
            value => value.includes('@')
        );

        if (emailIndex < 0) {

            record.problems.push(
                'No email address found anywhere in the row.'
            );

            return record;
        }

        record.email = f[emailIndex];

        // Whatever sits between the ID and the email is a name.
        const names = f.slice(1, emailIndex).filter(Boolean);

        record.firstName = names[0] || '';
        record.lastName = names.slice(1).join(' ');

        // The row is read from both ends. Fixed landmarks are
        // found first - the student's phone just after the
        // email, the emergency contact's phone number, and the
        // Yes/No disability after it - and whatever lies in
        // between is the two addresses plus the contact's
        // name and address. Nothing is read by counting
        // columns, so blank columns (like the empty first
        // "relation" column) and addresses split over several
        // lines cannot push a value into the wrong field.
        const isYesNo = value =>
            /^(y(es)?|n(o)?)$/i.test(String(value || '').trim());

        // Real UK postcode, or a mistyped / anonymised one
        // (a short code, a space, three characters, with at
        // least one digit) at the end of a cell.
        const endsAddress = value => {

            if (postcodeOf(value)) {
                return true;
            }

            const match = String(value || '').trim().match(
                /\b[A-Z0-9]{2,4}\s+[A-Z0-9]{3}$/i
            );

            return !!(match && /\d/.test(match[0]));
        };

        let cursor = emailIndex + 1;

        // Student phone, international (Yes/No), country.
        if (looksLikePhone(f[cursor])) {
            record.phone = f[cursor++];
        } else if (f[cursor] === '') {
            cursor++;
        }

        if (cursor < f.length && (isYesNo(f[cursor]) || f[cursor] === '')) {
            cursor++;
        }

        if (cursor < f.length && !/\d|@/.test(f[cursor])) {
            cursor++;
        }

        // The emergency contact's phone number anchors the
        // middle block.
        let numberIndex = -1;

        for (let i = cursor; i < f.length; i++) {

            if (looksLikePhone(f[i])) {
                numberIndex = i;
                break;
            }
        }

        let middleEnd = numberIndex;

        if (middleEnd < 0) {

            middleEnd = f.findIndex(
                (value, index) =>
                    index >= cursor && looksLikeRelationship(value)
            );

            if (middleEnd < 0) {

                middleEnd = f.findIndex(
                    (value, index) =>
                        index >= cursor && isYesNo(value)
                );
            }

            if (middleEnd < 0) {
                middleEnd = f.length;
            }
        }

        record.ecNumber = numberIndex >= 0 ? f[numberIndex] : '';

        // Relationship and disability: after the number there
        // may be an empty "relation" column, then the real
        // relationship, then Yes/No. The Yes/No is found
        // first and the relationship is whatever sits just
        // before it - dates and funding text further along
        // are never looked at.
        const tail = f
            .slice(numberIndex >= 0 ? numberIndex + 1 : middleEnd)
            .slice(0, 5);

        const yesNoAt = tail.findIndex(isYesNo);

        if (yesNoAt >= 0) {

            record.disability = tail[yesNoAt];

            record.relationship =
                tail.slice(0, yesNoAt).filter(Boolean).pop() || '';

        } else {

            record.relationship =
                tail.find(looksLikeRelationship) || '';
        }

        record.relationshipValue =
            relationshipFor(record.relationship);

        record.hasDisability = /^y(es)?$/i.test(
            String(record.disability).trim()
        );

        if (
            record.relationship &&
            !looksLikeRelationship(record.relationship)
        ) {

            record.problems.push(
                'Relationship column reads "' +
                record.relationship +
                '" - treated as Trusted.'
            );
        }

        if (!record.disability) {

            record.problems.push(
                'No Yes/No disability value found after the ' +
                'relationship.'
            );
        }

        // Between country and the contact's number: permanent
        // address, term address, contact name, contact address.
        const middle = f.slice(cursor, middleEnd);

        let parts;

        if (middle.length === 4) {

            parts = middle;

        } else {

            const cells = middle.filter(Boolean);

            const split = test => {

                const ends = [];

                cells.forEach(
                    (cell, index) => {
                        if (test(cell)) {
                            ends.push(index);
                        }
                    }
                );

                if (ends.length < 2) {
                    return null;
                }

                const rest = cells.slice(ends[1] + 1);

                return [
                    cells.slice(0, ends[0] + 1).join(', '),
                    cells.slice(ends[0] + 1, ends[1] + 1).join(', '),
                    rest[0] || '',
                    rest.slice(1).join(', ')
                ];
            };

            parts =
                (cells.length === 4 ? cells : null) ||
                split(value => !!postcodeOf(value)) ||
                split(endsAddress);

            if (!parts) {

                parts = [
                    cells[0] || '',
                    cells[1] || '',
                    cells[2] || '',
                    cells.slice(3).join(', ')
                ];

                record.problems.push(
                    'Could not tell where the addresses end - ' +
                    'check the permanent / term / contact ' +
                    'address columns.'
                );
            }
        }

        record.permanentAddress = cleanField(parts[0]).replace(/,\s*,/g, ',');
        record.termAddress = cleanField(parts[1]).replace(/,\s*,/g, ',');
        record.ecName = cleanField(parts[2]).replace(/,\s*,/g, ',');
        record.ecAddress = cleanField(parts[3]).replace(/,\s*,/g, ',');

        if (/\d/.test(record.ecName) && !isEmail(record.ecName)) {

            record.problems.push(
                'Emergency contact name reads "' +
                record.ecName + '" - it contains digits.'
            );
        }

        if (
            record.disability &&
            !/^(y(es)?|n(o)?)$/i.test(String(record.disability).trim())
        ) {

            record.problems.push(
                'Disability column reads "' +
                record.disability +
                '" - expected Yes or No.'
            );
        }

        // Sanity checks on what landed where.
        if (record.phone && !looksLikePhone(record.phone)) {

            record.problems.push(
                'Student phone column reads "' +
                record.phone + '".'
            );
        }

        if (record.ecNumber && !looksLikePhone(record.ecNumber)) {

            record.problems.push(
                'Emergency contact number column reads "' +
                record.ecNumber + '".'
            );
        }

        if (record.ecName && looksLikePhone(record.ecName)) {

            record.problems.push(
                'Emergency contact name column looks like a ' +
                'phone number ("' + record.ecName + '").'
            );
        }

        return record;
    }


    // =========================================================
    // COMPARISONS
    // =========================================================

    // Spaces, and the 07 / +44 / 44 prefixes, are ignored.
    function phoneKey(value) {

        let digits = String(value || '').replace(/\D/g, '');

        if (digits.startsWith('44')) {
            digits = digits.slice(2);
        }

        digits = digits.replace(/^0+/, '');

        return digits;
    }


    function samePhone(a, b) {

        const left = phoneKey(a);
        const right = phoneKey(b);

        if (!left || !right) {
            return false;
        }

        if (left === right) {
            return true;
        }

        // Last nine digits, for odd prefixes.
        return left.slice(-9) === right.slice(-9);
    }


    function sameEmail(a, b) {

        return normalise(a) === normalise(b) && !!normalise(a);
    }


    function isEmail(value) {
        return String(value || '').includes('@');
    }


    function postcodeOf(value) {

        const match = String(value || '')
            .toUpperCase()
            .match(/[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/);

        return match ? match[0].replace(/\s+/g, '') : '';
    }


    function addressKey(value) {

        return String(value || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim();
    }


    // "Somewhat matches": same postcode, or a decent overlap
    // of the words.
    function addressLooksSame(a, b) {

        const left = addressKey(a);
        const right = addressKey(b);

        if (!left || !right) {
            return false;
        }

        const leftPost = postcodeOf(a);
        const rightPost = postcodeOf(b);

        if (leftPost && rightPost) {
            return leftPost === rightPost;
        }

        const leftWords = new Set(left.split(' ').filter(Boolean));
        const rightWords = right.split(' ').filter(Boolean);

        if (!rightWords.length) {
            return false;
        }

        const shared = rightWords.filter(
            word => leftWords.has(word)
        ).length;

        return shared / rightWords.length >= 0.5;
    }


    // Building name gets everything except the postcode,
    // which has its own field.
    function splitAddress(value) {

        const text = cleanField(value);

        const match = text.match(
            /[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}/i
        );

        if (!match) {
            return { rest: text, postcode: '' };
        }

        const postcode = match[0]
            .replace(/\s+/g, ' ')
            .toUpperCase()
            .trim();

        const rest = (
            text.slice(0, match.index) +
            ' ' +
            text.slice(match.index + match[0].length)
        )
            .replace(/\s+/g, ' ')
            .replace(/^[,\s]+|[,\s]+$/g, '')
            .replace(/,\s*,/g, ',');

        return { rest, postcode };
    }


    // =========================================================
    // READING THE PERSON PAGE
    // =========================================================

    // The emergency contact row carries fields called
    // "...Number" and "...EmailAddress" too, and the page
    // repeats whole tables, so every read is scoped to the
    // student's own section and de-duplicated. Mixing the two
    // up is what put a contact's number in the phone report.
    function inEmergencyContacts(element) {

        return !!(
            element.closest &&
            (element.closest('#emergencycontactTable') ||
             element.closest('[id="emergencycontactTable"]') ||
             /^EmergencyContacts/.test(
                 element.getAttribute('name') || ''
             ))
        );
    }


    function fieldValues(nameStart, nameEnd) {

        const values = [
            ...document.querySelectorAll(
                '[name^="' + nameStart + '"][name$="' + nameEnd + '"]'
            )
        ].filter(
            field => !inEmergencyContacts(field)
        ).map(
            field => cleanField(field.value)
        ).filter(Boolean);

        // The same row can appear more than once on the page.
        return [...new Set(values)];
    }


    function readEmails() {
        return fieldValues('ElectronicAddresses', '.Value');
    }


    function readPhones() {
        return fieldValues('PhoneNumbers', '.Number');
    }


    // The row that will actually be edited, and what it holds
    // now - shown in the approval so there is no guessing.
    function studentPhoneRows() {

        return [
            ...document.querySelectorAll(
                'tr[id^="PhoneNumbers_"]'
            )
        ].filter(
            row =>
                !inEmergencyContacts(row) &&
                row.querySelector('[name$=".Number"]')
        );
    }


    function studentEmailRows() {

        return [
            ...document.querySelectorAll('tr')
        ].filter(
            row =>
                !inEmergencyContacts(row) &&
                row.querySelector(
                    '[name^="ElectronicAddresses"][name$=".Value"]'
                )
        );
    }


    function describeRow(row, suffix) {

        if (!row) {
            return '(no row found)';
        }

        const field = row.querySelector('[name$="' + suffix + '"]');

        const cells = [...row.querySelectorAll('td')]
            .slice(0, 2)
            .map(cell => cleanField(cell.textContent))
            .filter(Boolean);

        return (
            row.id +
            ' (' +
            (field ? cleanField(field.value) || 'empty' : 'no field') +
            (cells.length ? ' — ' + cells.join(' / ') : '') +
            ')'
        );
    }


    function readAddresses() {

        return [
            ...document.querySelectorAll(
                '#mailingaddressTable tbody tr[id^="Addresses_"]'
            )
        ].map(
            row => {

                const cell = row.querySelector('td');

                return cleanField(
                    cell ? cell.textContent : ''
                );
            }
        ).filter(Boolean);
    }


    function emergencyContactRows() {

        return [
            ...document.querySelectorAll(
                '#emergencycontactTable tbody tr[id^="EmergencyContacts_"]'
            )
        ];
    }


    // <input name="EmergencyContacts[0].FlexiFieldValues"
    //        value='{"ComPersonEmergencyContactAddress":[{...}]}'>
    function contactAddressOf(row) {

        const field = row && row.querySelector(
            '[name$=".FlexiFieldValues"]'
        );

        if (!field || !field.value) {
            return '';
        }

        try {

            const data = JSON.parse(field.value);

            const address =
                (data.ComPersonEmergencyContactAddress || [])[0];

            if (!address) {
                return '';
            }

            return [
                address.ComPersonEmergencyECAddressLine1,
                address.ComPersonEmergencyECAddressLine2,
                address.ComPersonEmergencyECAddressLine3,
                address.ComPersonEmergencyECTownCity,
                address.ComPersonEmergencyECPostcodeZIPCode
            ].filter(Boolean).join(', ');

        } catch (error) {

            return '';
        }
    }


    function readEmergencyContacts() {

        return emergencyContactRows().map(
            row => {

                const value = suffix => {

                    const field = row.querySelector(
                        '[name$="' + suffix + '"]'
                    );

                    return field ? cleanField(field.value) : '';
                };

                return {
                    row,
                    id: row.id,
                    name: value('.EmergencyContactName'),
                    number: value('.Number'),
                    email: value('.EmailAddress'),
                    relationship: cleanField(
                        (row.querySelector('td') || {}).textContent
                    )
                };
            }
        );
    }


    function readDisabilities() {

        const hidden = document.querySelector('#Disabilities');

        if (hidden && cleanField(hidden.value)) {
            return cleanField(hidden.value);
        }

        const label =
            document.querySelector('label[for="Disabilities"]');

        if (!label) {
            return '';
        }

        const field = label.closest('.field') || label.parentElement;
        const span = field && field.querySelector('span');

        return span ? cleanField(span.textContent) : '';
    }


    function hasPreferNotToSayDisability(value) {

        const text = normalise(value);

        return (
            text.includes('prefer not to say') ||
            text.includes('prefer not to disclose')
        );
    }


    function readPerson() {

        return {
            emails: readEmails(),
            phones: readPhones(),
            addresses: readAddresses(),
            contacts: readEmergencyContacts(),
            disabilities: readDisabilities()
        };
    }


    // =========================================================
    // WHAT NEEDS CHANGING
    // =========================================================

    function buildChanges(record, current) {

        const changes = [];
        const notes = [];

        // ---- Disability ----
        // The spreadsheet Yes/No is only an instruction for
        // this workflow. It never attempts to infer a specific
        // disability type.

        if (record.hasDisability) {

            if (!hasPreferNotToSayDisability(current.disabilities)) {

                changes.push({
                    kind: 'disability-add',
                    title:
                        'Disability indicated - add ' +
                        '"Prefer not to say"',
                    detail: [
                        'Sheet disability : Yes',
                        'In TSM           : ' +
                        (current.disabilities || '(none)'),
                        '',
                        'Action : Contact Information → Edit, add ' +
                        '"Prefer not to say" under Disabilities, ' +
                        'then press OK.'
                    ],
                    value: 'Prefer not to say'
                });

            } else {

                notes.push(
                    '✓ Disability already includes ' +
                    '"Prefer not to say".'
                );
            }
        }

        // ---- Student email: keep every existing address,
        // add the sheet address as another Electronic Address
        // if it is not already on record ----

        if (record.email) {

            const match = current.emails.some(
                email => sameEmail(email, record.email)
            );

            if (!match) {

                changes.push({
                    kind: 'email-add',
                    title: 'Student email is not on record - add it',
                    detail: [
                        'In TSM : ' +
                        (current.emails.join(', ') || '(none)'),
                        'Sheet  : ' + record.email,
                        '',
                        'Action : click Add under Electronic ' +
                        'Addresses and add the sheet address. ' +
                        'Existing email addresses are left ' +
                        'unchanged.'
                    ],
                    value: record.email
                });
            }
        }

        // ---- Student phone: keep every existing number, add
        // the sheet number as another Phone Number if it is
        // not already on record ----

        if (record.phone) {

            const match = current.phones.some(
                phone => samePhone(phone, record.phone)
            );

            if (!match) {

                changes.push({
                    kind: 'phone-add',
                    title: 'Student phone is not on record - add it',
                    detail: [
                        'In TSM : ' +
                        (current.phones.join(', ') || '(none)'),
                        'Sheet  : ' + record.phone,
                        '',
                        'Action : click Add under Phone Numbers ' +
                        'and add the sheet number. Existing phone ' +
                        'numbers are left unchanged. Prefixes ' +
                        '(+44 / 44 / 07) and spacing are ignored ' +
                        'when comparing.'
                    ],
                    value: record.phone
                });
            }
        }

        // ---- Permanent address: reported, never changed ----

        if (record.permanentAddress) {

            const match = current.addresses.some(
                address => addressLooksSame(
                    address,
                    record.permanentAddress
                )
            );

            if (!match) {

                notes.push(
                    '⚠ Permanent address has no close match in TSM.'
                );
                notes.push('    Sheet : ' + record.permanentAddress);
                notes.push(
                    '    TSM   : ' +
                    (current.addresses.join(' | ') || '(none)')
                );
            }
        }

        // ---- Term-time address: add it if there is no close
        // match already on record ----

        if (record.termAddress) {

            const match = current.addresses.some(
                address => addressLooksSame(address, record.termAddress)
            );

            if (!match) {

                const parts = splitAddress(record.termAddress);

                changes.push({
                    kind: 'term-address-add',
                    title:
                        'Term-time address is not on record - ' +
                        'add it',
                    detail: [
                        'Sheet    : ' + record.termAddress,
                        'Building : ' + (parts.rest || '(empty)'),
                        'Postcode : ' +
                        (parts.postcode || '(not detected)'),
                        '',
                        'Action : click Add under Mailing ' +
                        'Addresses, put the main address in ' +
                        'Building Name and the postcode in ' +
                        'Postal Code, then press OK.',
                        '',
                        'Permanent-address differences remain ' +
                        'report-only.'
                    ],
                    value: record.termAddress,
                    buildingName: parts.rest,
                    postalCode: parts.postcode
                });
            }
        }

        // ---- Emergency contact ----

        if (record.ecName) {

            // The sheet column is an address, but an email is
            // accepted there too if one was pasted in.
            const wantedEmail = isEmail(record.ecAddress)
                ? record.ecAddress
                : '';

            const existing = current.contacts.find(
                contact => normalise(contact.name) ===
                    normalise(record.ecName)
            );

            if (!current.contacts.length) {

                changes.push({
                    kind: 'contact-add',
                    title: 'No emergency contact on record - add one',
                    detail: [
                        'Name         : ' + record.ecName,
                        'Number       : ' + (record.ecNumber || '(none)'),
                        'Email        : ' + (wantedEmail || '(none)'),
                        'Relationship : ' +
                        record.relationshipValue +
                        (record.relationship
                            ? ' (sheet says "' + record.relationship + '")'
                            : ' (nothing in the sheet)'),
                        '',
                        record.ecAddress
                            ? 'Their address (' + record.ecAddress +
                              ') has nowhere to go on this form.'
                            : ''
                    ].filter(Boolean),
                    record,
                    email: wantedEmail
                });

            } else if (!existing) {

                notes.push(
                    '⚠ Emergency contact on file is "' +
                    current.contacts.map(c => c.name).join(', ') +
                    '", the sheet says "' + record.ecName + '".'
                );
                notes.push(
                    '    Left alone - check this one by hand.'
                );

            } else {

                // TSM keeps the contact's address in a JSON
                // blob on the row. Reported, never rewritten.
                if (record.ecAddress && !isEmail(record.ecAddress)) {

                    const held = contactAddressOf(existing.row);

                    if (held && !addressLooksSame(held, record.ecAddress)) {

                        notes.push(
                            '⚠ Emergency contact address differs.'
                        );
                        notes.push('    Sheet : ' + record.ecAddress);
                        notes.push('    TSM   : ' + held);
                    }
                }

                const needsNumber =
                    record.ecNumber &&
                    !samePhone(existing.number, record.ecNumber);

                const needsEmail =
                    wantedEmail &&
                    !sameEmail(existing.email, wantedEmail);

                if (needsNumber || needsEmail) {

                    changes.push({
                        kind: 'contact-edit',
                        title:
                            'Emergency contact "' +
                            existing.name +
                            '" needs updating',
                        detail: [
                            needsNumber
                                ? 'Number : ' +
                                  (existing.number || '(none listed)') +
                                  '  →  ' + record.ecNumber
                                : '',
                            needsEmail
                                ? 'Email  : ' +
                                  (existing.email || '(none listed)') +
                                  '  →  ' + wantedEmail
                                : ''
                        ].filter(Boolean),
                        rowId: existing.id,
                        number: needsNumber ? record.ecNumber : '',
                        email: needsEmail ? wantedEmail : ''
                    });
                }
            }
        }

        return { changes, notes };
    }


    // =========================================================
    // ASK BEFORE CHANGING ANYTHING
    // =========================================================

    let approveAll = false;


    // The shared prompt: a heading, some detail, and a set of
    // buttons. Used for proposed changes and for the record
    // warnings alike.
    function askChoice(title, detail, buttons) {

        return new Promise(resolve => {

            const box = document.getElementById('tsm-approve');

            // A question cannot be answered behind a hidden
            // panel, so hiding is undone whenever one appears.
            setPanelHidden(false, false);

            box.innerHTML = '';
            box.style.display = 'block';

            // Make sure it is actually on screen - the panel
            // can be taller than the window.
            try {

                box.scrollIntoView({
                    behavior: 'instant',
                    block: 'center'
                });

            } catch (error) {}

            const text = document.createElement('div');

            Object.assign(text.style, {
                whiteSpace: 'pre-line',
                marginBottom: '8px',
                fontSize: '12px',
                lineHeight: '1.5'
            });

            text.textContent =
                title + '\n\n' + detail.join('\n');

            box.appendChild(text);

            const finish = answer => {

                box.innerHTML = '';
                box.style.display = 'none';

                resolve(answer);
            };

            for (const option of buttons) {

                const element = document.createElement('button');

                element.textContent = option.label;

                Object.assign(element.style, {
                    width: '100%',
                    padding: '9px',
                    marginTop: '6px',
                    cursor: 'pointer',
                    fontWeight: 'bold',
                    background: option.background || '',
                    color: option.background ? '#fff' : ''
                });

                element.addEventListener(
                    'click',
                    () => finish(option.value)
                );

                box.appendChild(element);
            }
        });
    }


    async function askApproval(change) {

        // "Apply all" was chosen earlier for this student.
        if (approveAll) {
            return 'apply';
        }

        const answer = await askChoice(
            change.title,
            change.detail,
            [
                {
                    label: 'APPLY THIS CHANGE',
                    value: 'apply',
                    background: '#1f5c2f'
                },
                {
                    label: 'SKIP THIS CHANGE',
                    value: 'skip',
                    background: '#5c1f1f'
                },
                {
                    label: 'APPLY EVERYTHING FOR THIS STUDENT',
                    value: 'all'
                }
            ]
        );

        if (answer === 'all') {
            approveAll = true;
            return 'apply';
        }

        return answer;
    }


    // Finance hold: reported, never acted on by itself.
    async function askAboutWarnings(studentId, warnings) {

        if (!warnings.length) {
            return 'continue';
        }

        return await askChoice(
            'Student ' + studentId + ' - check before changing anything',
            warnings.concat([
                '',
                'Nothing has been modified yet.'
            ]),
            [
                {
                    label: 'CARRY ON WITH THIS STUDENT',
                    value: 'continue',
                    background: '#1f5c2f'
                },
                {
                    label: 'SKIP THIS STUDENT',
                    value: 'skip',
                    background: '#5c1f1f'
                }
            ]
        );
    }


    // Not enrolled is a problem, not a skip: the run pauses so
    // the student can be enrolled by hand, then the status is
    // read again and the data check carries on.
    async function requireEnrolled(studentId) {

        while (true) {

            checkStopped();

            const status = await readEnrolmentStatus();

            if (normalise(status).includes('enrolled') &&
                !isReadyForEnrolment(status)) {

                return { ok: true, status };
            }

            const shown = status || '(could not be read)';

            setStatus(
                'Student ' +
                studentId +
                ' is NOT enrolled.\n\n' +
                'Enrolment Status: ' +
                shown +
                '\n\nNothing has been changed. Enrol them in ' +
                'another tab if you want to, then choose below.'
            );

            const answer = await askChoice(
                'Student ' + studentId + ' is not enrolled',
                [
                    'Enrolment Status: ' + shown,
                    '',
                    'The data check has not touched anything yet.',
                    '',
                    'Enrol them manually if you want to, then',
                    'press CHECK AGAIN to carry on with this',
                    'same student.'
                ],
                [
                    {
                        label: 'CHECK AGAIN',
                        value: 'recheck',
                        background: '#1f5c2f'
                    },
                    {
                        label: 'CHECK THE DATA ANYWAY',
                        value: 'anyway'
                    },
                    {
                        label: 'SKIP THIS STUDENT',
                        value: 'skip',
                        background: '#5c1f1f'
                    }
                ]
            );

            if (answer === 'recheck') {

                setStatus('Reading the Enrolment Status again...');

                await sleep(1500);

                continue;
            }

            return { ok: answer === 'anyway', status, answer };
        }
    }


    // =========================================================
    // APPLYING A CHANGE
    // =========================================================

    // The container that owns a field AND carries an edit
    // control - a table row here, but never the whole page.
    function rowHolding(selector) {

        const field = document.querySelector(selector);

        if (!field) {
            return null;
        }

        const row =
            field.closest('tr[data-editurl]') ||
            field.closest('tr') ||
            field.closest('[data-editurl]');

        if (row && row.querySelector('span.icon.editIcon')) {
            return row;
        }

        // Fall back to the nearest ancestor that has one.
        let node = field.parentElement;

        while (node && node !== document.body) {

            if (node.querySelector('span.icon.editIcon')) {
                return node;
            }

            node = node.parentElement;
        }

        return null;
    }


    function editIconOf(row) {

        return row
            ? row.querySelector('span.icon.editIcon')
            : null;
    }


    // Where a row's edit form lives: TSM names it on the row
    // itself (data-dialogdiv="phonenumberEdit"). Searching the
    // whole document instead is how an emergency contact's
    // Number field ended up being typed into.
    function editScopesFor(row) {

        const scopes = [];

        if (row) {

            const name = row.getAttribute('data-dialogdiv');

            if (name) {

                const dialog = document.getElementById(name);

                if (dialog) {
                    scopes.push(dialog);
                }
            }

            // Fields the dialog renders carry the row's id.
            if (row.id) {
                scopes.push('[data-source="' + row.id + '"]');
            }

            scopes.push(row);
        }

        return scopes;
    }


    function visibleField(root, suffix) {

        const query =
            'input[name$="' + suffix + '"], ' +
            'textarea[name$="' + suffix + '"]';

        const candidates =
            typeof root === 'string'
                ? [...document.querySelectorAll(root)].filter(
                    element => element.matches(query)
                )
                : [...root.querySelectorAll(query)];

        return candidates.find(
            field =>
                field.type !== 'hidden' &&
                isVisible(field) &&
                !field.disabled
        ) || null;
    }


    // Scope first, document last - and never a field belonging
    // to the emergency contacts table when editing the
    // student's own details.
    function editableField(suffix, scope, allowContacts) {

        const roots = Array.isArray(scope)
            ? scope
            : (scope ? [scope] : []);

        for (const root of roots) {

            const found = visibleField(root, suffix);

            if (found) {
                return found;
            }
        }

        return [
            ...document.querySelectorAll(
                'input[name$="' + suffix + '"], ' +
                'textarea[name$="' + suffix + '"]'
            )
        ].find(
            field =>
                field.type !== 'hidden' &&
                isVisible(field) &&
                !field.disabled &&
                (allowContacts || !inEmergencyContacts(field))
        ) || null;
    }


    async function openRowEditor(row, suffix, allowContacts) {

        const icon = editIconOf(row);

        if (!icon) {
            throw new Error('No edit control on that row.');
        }

        const scopes = editScopesFor(row);

        await clickUntil({
            getElement: () => editIconOf(row) || icon,
            verify: () => editableField(suffix, scopes, allowContacts),
            description: 'the edit form for ' + (row.id || 'that row'),
            verifyTimeout: WAIT.editForm
        });

        return editableField(suffix, scopes, allowContacts);
    }


    async function setField(field, value) {

        if (!field) {
            return false;
        }

        await realMouseClick(field);

        await typeInto(field, value);

        field.dispatchEvent(new Event('change', { bubbles: true }));

        return true;
    }


    // Relationship is a select2. Blank means "Trusted".
    // Shared driver for a select2 SINGLE dropdown: open it,
    // type some text, take the first match with Down then
    // Enter. The search box is not inside the container once
    // it opens - select2 moves it to a drop-down attached to
    // the page body - so it is found by being the one visible
    // select2 input, same as the relationship field below.
    async function driveSelect2(container, text, description) {

        if (!container) {
            return 'no ' + description + ' found';
        }

        const choice = container.querySelector('a.select2-choice');

        if (choice) {
            await realMouseClick(choice);
        }

        const input =
            await waitFor(
                () => [
                    ...document.querySelectorAll('input.select2-input')
                ].filter(isVisible).find(
                    element => element.offsetParent !== null
                ) || null,
                WAIT.editForm,
                'the ' + description + ' search box'
            );

        await typeInto(input, text);

        await sleep(800);

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

        return 'set to ' + text;
    }


    // Relationship is a select2. Blank means "Trusted".
    async function setRelationship(text) {

        const container = [
            ...document.querySelectorAll('[id^="s2id_"]')
        ].filter(isVisible).find(
            element => /emergencycontacttype|relationship/i
                .test(element.id)
        );

        return await driveSelect2(
            container,
            text,
            'relationship field'
        );
    }


    // A newly-added Electronic Address defaults its Type to
    // "<Select one>", which fails validation on Save. The
    // dropdown is found by the same row index as the Value
    // field just added, so the right row is driven even when
    // more than one Electronic Address is on screen.
    async function setElectronicAddressTypeToEmail(field) {

        const match = (field.getAttribute('name') || '').match(
            /ElectronicAddresses\[(\d+)\]/
        );

        if (!match) {
            return 'could not tell which row this is - type not set';
        }

        const containerId =
            's2id_ElectronicAddresses_' + match[1] + '__TypeEntryID';

        const container = await waitFor(
            () => {

                const element = document.getElementById(containerId);

                return (element && isVisible(element)) ? element : null;
            },
            WAIT.editForm,
            'the email type dropdown'
        );

        return await driveSelect2(container, 'email', 'email type');
    }


    // This was missing in v1.0: confirmDialogOk referenced it,
    // threw a ReferenceError, and the change was recorded as
    // failed - so OK was never pressed and nothing was saved.
    function findOkButton() {

        const candidates = [
            ...document.querySelectorAll('button.okButton')
        ].filter(
            button =>
                isVisible(button) &&
                !button.disabled &&
                !button.getAttribute('data-save-button')
        );

        const dialog = candidates.find(
            button => button.classList.contains('ui-button')
        );

        if (dialog) {
            return dialog;
        }

        if (candidates.length) {
            return candidates[0];
        }

        // Last resort: an OK in a jQuery UI button set.
        return [
            ...document.querySelectorAll(
                '.ui-dialog-buttonset button, button.ui-button'
            )
        ].filter(isVisible).find(
            button => normalise(button.textContent) === 'ok'
        ) || null;
    }


    async function confirmDialogOk() {

        const ok =
            await waitFor(
                findOkButton,
                WAIT.okButton,
                'the OK button'
            );

        await realMouseClick(ok);

        try {

            await waitFor(
                () => (!ok.isConnected || !isVisible(ok)) ? true : null,
                WAIT.okButton,
                'the dialog to close'
            );

        } catch (error) {

            // Left open - the save will surface any problem.
        }

        await sleep(DELAY.afterDialog);
    }


    // Read the value back after the dialog closes, so a field
    // that silently refused the input is reported instead of
    // being counted as applied.
    function verifyValue(readValues, wanted, compare) {

        const values = readValues();

        return values.some(value => compare(value, wanted))
            ? ''
            : ' (WARNING: still reads ' +
              (values.join(', ') || 'empty') + ')';
    }


    // =========================================================
    // ADD-A-ROW HELPERS (email, phone, term-time address,
    // disability)
    //
    // These never touch an existing row: each one clicks an
    // Add button, fills in the new row it creates, and leaves
    // whatever was already there alone.
    // =========================================================

    function findAddButtonFor(targetId) {

        return [
            ...document.querySelectorAll(
                'button[onclick*="addTableItem"]'
            )
        ].filter(isVisible).find(
            button => (button.getAttribute('onclick') || '')
                .includes(targetId)
        ) || null;
    }


    function findPhoneAddButton() {
        return findAddButtonFor('PhoneNumberTOCTab');
    }


    function findEmailAddButton() {
        return findAddButtonFor('ElectronicAddressTOCTab');
    }


    function findAddressAddButton() {
        return findAddButtonFor('MailingAddressTOCTab');
    }


    function matchingEditableFields(
        binding,
        nameStart,
        tagNames = 'input, textarea'
    ) {

        const tags = String(tagNames)
            .split(',')
            .map(tag => tag.trim())
            .filter(Boolean);

        const selector = tags.map(
            tag =>
                tag + '[data-binding="' + binding + '"]' +
                '[name^="' + nameStart + '"]'
        ).join(', ');

        return [...document.querySelectorAll(selector)].filter(
            field =>
                field.type !== 'hidden' &&
                isVisible(field) &&
                !field.disabled
        );
    }


    // Clicks Add and returns the one new field that appeared -
    // never the first match on the page, which would just be
    // whatever row was already there.
    async function openAddAndGetNewField(
        findButton,
        binding,
        nameStart,
        description,
        tagNames = 'input, textarea'
    ) {

        const before = new Set(
            matchingEditableFields(binding, nameStart, tagNames)
        );

        const add = await waitFor(
            findButton,
            WAIT.editForm,
            description + ' Add button'
        );

        await clickUntil({
            getElement: () => findButton() || add,
            verify: () =>
                matchingEditableFields(
                    binding,
                    nameStart,
                    tagNames
                ).find(field => !before.has(field)) || null,
            description: description + ' form',
            verifyTimeout: WAIT.editForm
        });

        return await waitFor(
            () =>
                matchingEditableFields(
                    binding,
                    nameStart,
                    tagNames
                ).find(field => !before.has(field)) || null,
            WAIT.editForm,
            description + ' field'
        );
    }


    function findPersonEditButton() {

        return [...document.querySelectorAll('button')]
            .filter(isVisible)
            .find(
                button => {

                    const onclick = button.getAttribute('onclick') || '';

                    return (
                        !!button.querySelector('.editIcon') &&
                        onclick.includes('trs.ui.editItem') &&
                        (
                            onclick.includes("$('#Person')") ||
                            onclick.includes('$("#Person")')
                        )
                    );
                }
            ) || null;
    }


    function findDisabilitySelect2() {

        const container =
            document.querySelector('#s2id_DisabilitiesIDs');

        return (container && isVisible(container)) ? container : null;
    }


    function findDisabilitySearchInput() {

        const container = findDisabilitySelect2();

        if (!container) {
            return null;
        }

        return [
            ...container.querySelectorAll('input.select2-input')
        ].find(input => isVisible(input) && !input.disabled) || null;
    }


    async function addStudentPhone(number) {

        const field = await openAddAndGetNewField(
            findPhoneAddButton,
            'Number',
            'PhoneNumbers[',
            'new phone',
            'input'
        );

        await setField(field, number);

        await confirmDialogOk();

        return 'additional phone added' +
            verifyValue(readPhones, number, samePhone);
    }


    async function addStudentEmail(email) {

        const field = await openAddAndGetNewField(
            findEmailAddButton,
            'Value',
            'ElectronicAddresses[',
            'new email',
            'textarea, input'
        );

        await setElectronicAddressTypeToEmail(field);

        await setField(field, email);

        await confirmDialogOk();

        return 'additional email added' +
            verifyValue(readEmails, email, sameEmail);
    }


    async function addTermAddress(address) {

        const parts = splitAddress(address);

        if (!parts.postcode) {
            throw new Error(
                'Could not detect a UK postcode in the ' +
                'term-time address.'
            );
        }

        const beforePostal = new Set(
            matchingEditableFields('PostalCode', 'Addresses[', 'input')
        );

        const building = await openAddAndGetNewField(
            findAddressAddButton,
            'BuildingName',
            'Addresses[',
            'new mailing address',
            'input'
        );

        const source = building.getAttribute('data-source') || '';

        const postcode = await waitFor(
            () => {

                const candidates = matchingEditableFields(
                    'PostalCode',
                    'Addresses[',
                    'input'
                );

                if (source) {

                    const sameSource = candidates.find(
                        field =>
                            field.getAttribute('data-source') === source
                    );

                    if (sameSource) {
                        return sameSource;
                    }
                }

                return candidates.find(
                    field => !beforePostal.has(field)
                ) || null;
            },
            WAIT.editForm,
            'the new mailing address postcode field'
        );

        await setField(building, parts.rest || cleanField(address));
        await setField(postcode, parts.postcode);

        await confirmDialogOk();

        const now = readAddresses();

        const present = now.some(
            value => addressLooksSame(value, address)
        );

        return present
            ? 'term-time address added'
            : 'term-time address added (WARNING: could not verify ' +
              'it in the mailing-address table after OK)';
    }


    async function addPreferNotToSayDisability() {

        const edit = await waitFor(
            findPersonEditButton,
            WAIT.editForm,
            'Contact Information Edit button'
        );

        await clickUntil({
            getElement: () => findPersonEditButton() || edit,
            verify: () => findDisabilitySearchInput(),
            description: 'Contact Information edit form',
            verifyTimeout: WAIT.editForm
        });

        const input = await waitFor(
            findDisabilitySearchInput,
            WAIT.editForm,
            'the Disabilities selector'
        );

        await realMouseClick(input);
        await typeInto(input, 'prefer');

        await sleep(800);

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

        await confirmDialogOk();

        const now = readDisabilities();

        return hasPreferNotToSayDisability(now)
            ? 'disability preference added'
            : 'disability preference added (WARNING: the Person ' +
              'page did not visibly read "Prefer not to say" ' +
              'after OK)';
    }


    const CHANGE_LABELS = {
        'email-add': 'Additional student email ADDED',
        'phone-add': 'Additional student phone ADDED',
        'term-address-add': 'Term-time address ADDED',
        'disability-add': 'Disability "Prefer not to say" ADDED',
        'contact-edit': 'Emergency contact updated',
        'contact-add': 'Emergency contact ADDED'
    };


    function changeLabel(change) {

        const label =
            CHANGE_LABELS[change.kind] || change.kind;

        if (change.kind === 'contact-add') {

            return (
                label +
                ': ' +
                change.record.ecName +
                (change.record.ecNumber
                    ? ' / ' + change.record.ecNumber
                    : '') +
                ' (' + change.record.relationshipValue + ')'
            );
        }

        if (change.kind === 'contact-edit') {

            return (
                label +
                ': ' +
                [
                    change.number ? 'number → ' + change.number : '',
                    change.email ? 'email → ' + change.email : ''
                ].filter(Boolean).join(', ')
            );
        }

        return label + ': ' + (change.value || '');
    }


    async function applyChange(change) {

        if (change.kind === 'email-add') {
            return await addStudentEmail(change.value);
        }

        if (change.kind === 'phone-add') {
            return await addStudentPhone(change.value);
        }

        if (change.kind === 'term-address-add') {
            return await addTermAddress(change.value);
        }

        if (change.kind === 'disability-add') {
            return await addPreferNotToSayDisability();
        }

        if (change.kind === 'contact-edit') {

            const row = document.getElementById(change.rowId);

            if (!row) {
                throw new Error('That emergency contact row is gone.');
            }

            const scopes = editScopesFor(row);

            const field = await openRowEditor(
                row,
                change.number ? '.Number' : '.EmailAddress',
                true
            );

            if (change.number) {
                await setField(field, change.number);
            }

            if (change.email) {

                await setField(
                    editableField('.EmailAddress', scopes, true),
                    change.email
                );
            }

            await confirmDialogOk();

            return 'emergency contact updated';
        }

        if (change.kind === 'contact-add') {

            const add =
                await waitFor(
                    findEmergencyAddButton,
                    WAIT.editForm,
                    'the Add button'
                );

            await clickUntil({
                getElement: () => findEmergencyAddButton() || add,
                verify: () => editableField(
                    '.EmergencyContactName',
                    [
                        document.getElementById('emergencycontactEdit'),
                        '[data-source^="EmergencyContacts_"]'
                    ].filter(Boolean),
                    true
                ),
                description: 'the new contact form',
                verifyTimeout: WAIT.editForm
            });

            // Everything for the new contact lives in the
            // emergency contact form - never the student's
            // own phone or email rows.
            const scopes = [
                document.getElementById('emergencycontactEdit'),
                '[data-source^="EmergencyContacts_"]',
                document.querySelector('#emergencycontactTable')
            ].filter(Boolean);

            await setField(
                editableField('.EmergencyContactName', scopes, true),
                change.record.ecName
            );

            if (change.record.ecNumber) {

                await setField(
                    editableField('.Number', scopes, true),
                    change.record.ecNumber
                );
            }

            if (change.email) {

                await setField(
                    editableField('.EmailAddress', scopes, true),
                    change.email
                );
            }

            await setRelationship(
                change.record.relationshipValue || 'Trusted'
            );

            await confirmDialogOk();

            return 'emergency contact added';
        }

        return 'nothing to do';
    }


    function findEmergencyAddButton() {

        return [
            ...document.querySelectorAll('button[onclick*="addTableItem"]')
        ].filter(isVisible).find(
            button =>
                /EmergencyContact/i.test(
                    button.getAttribute('onclick') || ''
                )
        ) || null;
    }


    // =========================================================
    // SAVE THE PERSON RECORD
    // =========================================================

    function findSaveButton() {

        return [
            ...document.querySelectorAll('button[data-save-button="true"]')
        ].filter(isVisible)[0] || null;
    }


    function isDirty() {

        const save = findSaveButton();

        return !!(save && save.classList.contains('saveDirty'));
    }


    // Any dialog still sitting open would swallow the Save
    // click, so it is cleared first.
    let dialogsCleared = 0;


    async function clearOpenDialog() {

        const ok = findOkButton();

        if (!ok) {
            return false;
        }

        // Guard against a dialog that will not close.
        if (dialogsCleared >= 5) {
            return false;
        }

        dialogsCleared++;

        setStatus('An edit dialog is open - pressing OK...');

        await realMouseClick(ok);

        try {

            await waitFor(
                () => (!ok.isConnected || !isVisible(ok)) ? true : null,
                WAIT.okButton,
                'the dialog to close'
            );

        } catch (error) {

            return false;
        }

        await sleep(DELAY.afterDialog);

        return true;
    }


    async function savePerson() {

        await clearOpenDialog();

        const save =
            await waitFor(
                findSaveButton,
                WAIT.save,
                'the Save button'
            );

        setStatus('Saving...');

        await realMouseClick(save);

        // Give it the full processing time, then check the
        // form actually went clean.
        await sleep(DELAY.afterSave);

        const still = findSaveButton();

        if (still && isVisible(still) && still.classList.contains('saveDirty')) {

            setStatus(
                '⚠ Save was clicked but the record still looks ' +
                'unsaved - trying once more...'
            );

            await realMouseClick(still);

            await sleep(DELAY.afterSave);

            if (isDirty()) {

                setStatus(
                    '⚠ The record still looks unsaved. Check this ' +
                    'student before moving on.'
                );

                return 'Save clicked - record still dirty';
            }
        }

        setStatus('✓ Saved.');

        return 'Saved';
    }


    // =========================================================
    // PROCESS ONE STUDENT
    // =========================================================

    async function skipStudent(studentId, notes, reason) {

        recordFact({ status: 'SKIPPED - ' + reason, notes });

        markStage(studentId, 'processed');
        advanceRun(studentId);

        setStatus(
            'Student ' + studentId + ' skipped (' + reason + ').\n\n' +
            notes.join('\n')
        );

        await sleep(DELAY.beforeReturn);

        await returnToSAR();

        return {
            studentId,
            status: 'SKIPPED - ' + reason,
            applied: [],
            skipped: [],
            notes
        };
    }


    async function processStudent(studentId, request) {

        const record = request.records[studentId];

        if (!record) {
            throw new Error('No data row for ' + studentId + '.');
        }

        approveAll = false;
        dialogsCleared = 0;

        currentStudentId = studentId;

        recordFact({ studentId, started: true });

        setStatus('Processing student ' + studentId);

        await searchStudent(studentId);

        await openStudentRecord(studentId);

        // ---- Finance hold ----

        const warnings = [];

        if (CONFIG.checkFinanceHold && findHoldIcon()) {
            warnings.push('⚠ FINANCE HOLD icon is on this record.');
        }

        if (warnings.length) {

            setStatus(
                'Student ' + studentId + '\n\n' +
                warnings.join('\n') +
                '\n\nWaiting for you to decide below.'
            );

            const answer = CONFIG.dryRun
                ? 'continue'
                : await askAboutWarnings(studentId, warnings);

            if (answer !== 'continue') {
                return await skipStudent(studentId, warnings, 'by you');
            }
        }

        // ---- Must be enrolled ----

        let enrolmentStatus = '';

        if (CONFIG.checkEnrolmentStatus && !CONFIG.dryRun) {

            const enrolment = await requireEnrolled(studentId);

            enrolmentStatus = enrolment.status;

            if (!enrolment.ok) {

                return await skipStudent(
                    studentId,
                    warnings.concat([
                        '⚠ NOT ENROLLED - status "' +
                        (enrolment.status || 'unreadable') + '"'
                    ]),
                    'not enrolled'
                );
            }

            warnings.push('Enrolment Status: ' + enrolmentStatus);

        } else if (CONFIG.checkEnrolmentStatus) {

            enrolmentStatus = await readEnrolmentStatus();

            warnings.push(
                'Enrolment Status: ' +
                (enrolmentStatus || '(could not be read)')
            );
        }

        await openPerson();

        const current = readPerson();

        const { changes, notes } = buildChanges(record, current);

        const lines = [];

        lines.push('Student ' + studentId);
        lines.push('');
        lines.push('TSM emails    : ' +
            (current.emails.join(', ') || '(none)'));
        lines.push('TSM phones    : ' +
            (current.phones.join(', ') || '(none)'));
        lines.push('TSM contacts  : ' +
            (current.contacts.map(
                contact => contact.name +
                    ' / ' + (contact.number || 'no number')
            ).join(' | ') || '(none)'));
        lines.push('');

        if (warnings.length) {
            lines.push(...warnings);
            lines.push('');
        }

        if (notes.length) {
            lines.push(...notes);
            lines.push('');
        }

        if (!changes.length) {

            lines.push('✓ Nothing to change.');

            recordFact({ status: 'No changes needed', notes });

            markStage(studentId, 'processed');
            advanceRun(studentId);

            setStatus(lines.join('\n'));

            await sleep(DELAY.beforeReturn);

            await returnToSAR();

            return {
                studentId,
                status: 'No changes needed',
                applied: [],
                skipped: [],
                notes
            };
        }

        const applied = [];
        const skipped = [];

        for (let index = 0; index < changes.length; index++) {

            checkStopped();

            const change = changes[index];

            setStatus(
                lines.join('\n') +
                '\n\nChange ' +
                (index + 1) +
                ' of ' +
                changes.length +
                ' - waiting for you to approve it below.'
            );

            const answer = CONFIG.dryRun
                ? 'skip'
                : await askApproval(change);

            if (answer !== 'apply') {

                skipped.push(change.title);

                recordEntry('declined', changeLabel(change));

                continue;
            }

            try {

                const result = await applyChange(change);

                applied.push(change.title + ' → ' + result);

                // Written the moment it goes in, so a reload
                // cannot lose it from the report card.
                recordEntry(
                    'applied',
                    changeLabel(change) +
                    (result && !/updated|added/i.test(result)
                        ? ' [' + result + ']'
                        : '') +
                    (/WARNING/i.test(result) ? ' ' + result : '')
                );

            } catch (error) {

                skipped.push(
                    change.title + ' → FAILED: ' + error.message
                );

                recordEntry(
                    'failed',
                    changeLabel(change) + ' → ' + error.message
                );
            }
        }

        let saveStatus = 'Nothing to save';

        if (!CONFIG.dryRun) {

            // Whatever happened above, an edit dialog must not
            // be left open - it would swallow the Save click
            // and the record would go back unsaved.
            try {

                while (await clearOpenDialog()) {
                    checkStopped();
                }

            } catch (error) {

                // Nothing open, or it would not close.
            }

            // Save if a change went in, or if the form says it
            // has unsaved edits - a change that failed part
            // way through still leaves the record dirty.
            if (applied.length || isDirty()) {

                try {

                    saveStatus = await savePerson();

                } catch (error) {

                    saveStatus = 'SAVE FAILED: ' + error.message;
                }
            }
        }

        const failures = skipped.filter(
            item => item.includes('FAILED')
        );

        const report = lines.concat(
            failures.length
                ? [
                    '⚠ ' + failures.length + ' change(s) FAILED - ' +
                    'nothing was written for those.',
                    ''
                ]
                : []
        ).concat([
            'APPLIED',
            '=======',
            ...(applied.length ? applied : ['(none)']),
            '',
            'SKIPPED',
            '=======',
            ...(skipped.length ? skipped : ['(none)']),
            '',
            'Save: ' + saveStatus
        ]);

        recordFact({
            status: saveStatus,
            notes,
            warnings
        });

        markStage(studentId, 'processed');
        advanceRun(studentId);

        setStatus(
            '✓ STUDENT COMPLETE\n\n' + report.join('\n')
        );

        await sleep(DELAY.beforeReturn);

        await returnToSAR();

        return {
            studentId,
            status: saveStatus,
            applied,
            skipped,
            notes
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


    function markStage(studentId, stage) {
        saveRun({ current: { studentId, stage } });
    }


    // The student being worked on, and what has happened to
    // them, written to the saved run AS IT HAPPENS - the page
    // reloads under this script, and anything only held in
    // memory would never reach the report card.
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


    // Appends to a list on this student's record.
    function recordEntry(key, entry) {

        if (!currentStudentId) {
            return;
        }

        try {

            const run = (loadSettings().run || {});
            const facts = run.facts || {};
            const mine = facts[currentStudentId] || {};

            const list = Array.isArray(mine[key])
                ? mine[key].slice()
                : [];

            list.push(entry);

            recordFact({ [key]: list });

        } catch (error) {

            // Best effort.
        }
    }


    // The card is shown and then TSM reloads the page, so it
    // is kept and put back on the next load.
    function saveReport(text) {

        try {

            saveSetting('lastReport', {
                text: String(text || ''),
                at: Date.now(),
                tabId: TAB_ID
            });

        } catch (error) {}
    }


    function loadReport() {

        const report = (loadSettings() || {}).lastReport;

        if (!report || !report.text) {
            return null;
        }

        if (Date.now() - (report.at || 0) > 6 * 60 * 60 * 1000) {
            return null;
        }

        // Belt and braces: a report copied into a new tab is
        // not this tab's report.
        if (report.tabId && report.tabId !== TAB_ID) {
            return null;
        }

        return report;
    }


    function showReport(text, at) {

        const when = at ? new Date(at).toLocaleTimeString() : '';

        setStatus(
            (when ? 'Last batch report (' + when + ')\n\n' : '') +
            text
        );
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

        // Kept in the saved run as well as in memory, so the
        // card still covers students processed before a reload.
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
                    rows: request.rows || [],
                    index,
                    current: { studentId, stage: 'started' }
                });

                currentStudentId = studentId;

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

                    results.push({
                        studentId,
                        status: outcome.status,
                        applied: outcome.applied.length,
                        skipped: outcome.skipped.length,
                        notes: outcome.notes.length
                    });

                    saveRun({ results });

                } catch (error) {

                    console.error('TSM batch error:', error);

                    results.push({
                        studentId,
                        status: 'ERROR: ' + error.message,
                        applied: 0,
                        skipped: 0,
                        notes: 0
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

            const card =
                'BATCH ENDED\n\n' +
                error.message +
                '\n\n' +
                safeReportCard(results, false, studentIds);

            saveReport(card);

            setStatus(card, true);

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
    // Every change you accepted, per student, plus what was
    // declined, what failed and anything left to check.
    // =========================================================

    function plainReport(results, complete) {

        return (
            (complete ? '✓ BATCH COMPLETE' : 'BATCH ENDED EARLY') +
            '\n\n' +
            (results || []).map(
                item => item.studentId + ' — ' + item.status
            ).join('\n')
        );
    }


    function buildReportCard(results, complete, studentIds) {

        const run = loadSettings().run || {};
        const facts = run.facts || {};

        const ids = (
            Array.isArray(studentIds) && studentIds.length
                ? studentIds
                : (Array.isArray(run.studentIds)
                    ? run.studentIds
                    : results.map(item => item.studentId))
        );

        const rows = ids.map(
            studentId => {

                const result = results.find(
                    item => String(item.studentId) === String(studentId)
                ) || {};

                const noted = facts[studentId] || {};

                return {
                    studentId,
                    status:
                        result.status ||
                        noted.status ||
                        (noted.started
                            ? 'INCOMPLETE - no result recorded'
                            : 'not reached'),
                    applied: noted.applied || [],
                    declined: noted.declined || [],
                    failed: noted.failed || [],
                    notes: noted.notes || []
                };
            }
        );

        const lines = [];

        lines.push(complete ? '✓ BATCH COMPLETE' : 'BATCH ENDED EARLY');
        lines.push('');
        lines.push('REPORT CARD');
        lines.push('===========');

        for (const row of rows) {

            lines.push('');
            lines.push(row.studentId + ' — ' + row.status);

            for (const entry of row.applied) {
                lines.push('    ✓ ' + entry);
            }

            for (const entry of row.failed) {
                lines.push('    ✗ FAILED: ' + entry);
            }

            for (const entry of row.declined) {
                lines.push('    – skipped by you: ' + entry);
            }

            for (const note of row.notes) {

                if (String(note).trim()) {
                    lines.push('    ' + note);
                }
            }

            if (
                !row.applied.length &&
                !row.failed.length &&
                !row.declined.length
            ) {
                lines.push('    (no changes)');
            }
        }

        // Everything written, in one list.
        const changes = [];

        for (const row of rows) {

            for (const entry of row.applied) {
                changes.push(row.studentId + ' — ' + entry);
            }
        }

        const failures = rows.filter(row => row.failed.length);

        const attention = rows.filter(
            row =>
                row.failed.length ||
                /INCOMPLETE|still dirty|SAVE FAILED|not reached/i
                    .test(row.status)
        );

        lines.push('');
        lines.push('CHANGES APPLIED');
        lines.push('===============');

        if (changes.length) {
            lines.push(...changes);
        } else {
            lines.push('(none)');
        }

        lines.push('');
        lines.push('TOTALS');
        lines.push('======');
        lines.push('Students        : ' + rows.length);
        lines.push('Changes applied : ' + changes.length);
        lines.push(
            'Declined by you : ' +
            rows.reduce((sum, row) => sum + row.declined.length, 0)
        );
        lines.push('Failed          : ' + failures.length);

        if (attention.length) {

            lines.push('');
            lines.push('NEEDS ATTENTION');
            lines.push('===============');

            for (const row of attention) {
                lines.push(row.studentId + ' — ' + row.status);
            }
        }

        console.table(rows);

        return lines.join('\n');
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


    // =========================================================
    // ONE STUDENT
    // =========================================================

    async function runStudentWithRetries(studentId, request) {
        return await processStudent(studentId, request);
    }


    // =========================================================
    // USER INTERFACE
    // =========================================================

    // Everything the panel remembers is stored PER TAB, so
    // several windows can work on different rows at once.
    // A single shared key meant whichever tab saved last won,
    // and the next reload pulled its rows - and its report -
    // into all the others.
    const STORAGE_KEY = 'tsm-person-data-assistant';


    // The tab's identity. sessionStorage is per tab, and
    // window.name carries it as well so that clearing
    // sessionStorage mid-run cannot orphan the settings.
    const TAB_ID = (function () {

        const fresh = () => Math.random().toString(36).slice(2, 6);

        let id = '';

        try {
            id = window.sessionStorage.getItem('tsm-person-tab-id') || '';
        } catch (error) {}

        if (!id) {

            try {

                const named = String(window.name || '');

                if (named.startsWith('tsm-person-tab:')) {
                    id = named.slice('tsm-person-tab:'.length);
                }

            } catch (error) {}
        }

        if (!id) {
            id = fresh();
        }

        try {
            window.sessionStorage.setItem('tsm-person-tab-id', id);
        } catch (error) {}

        try {

            const named = String(window.name || '');

            // Never trample a name the site set for itself.
            if (!named || named.startsWith('tsm-person-tab:')) {
                window.name = 'tsm-person-tab:' + id;
            }

        } catch (error) {}

        return id;
    })();


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

        let session = null;
        let local = null;

        try {
            session = readFrom(window.sessionStorage);
        } catch (error) {}

        try {
            local = readFrom(window.localStorage);
        } catch (error) {}

        if (session && Object.keys(session).length) {
            return session;
        }

        return local || session || {};
    }


    function saveSetting(name, value) {

        const saved = loadSettings();

        saved[name] = value;

        const text = JSON.stringify(saved);

        // sessionStorage for the per tab guarantee, and
        // localStorage under the same per tab key as a backup
        // if sessionStorage is ever cleared.
        try {
            window.sessionStorage.setItem(tabKey(), text);
        } catch (error) {}

        try {
            window.localStorage.setItem(tabKey(), text);
        } catch (error) {}
    }


    // =========================================================
    // HIDE AND REOPEN
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

        const panels = [
            ...document.querySelectorAll('#tsm-batch-panel')
        ];

        const button = ensureReopenButton();

        for (const panel of panels) {

            if (hidden) {

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
                TSM Person Data Check
                <span class="tsm-tab">tab ${TAB_ID}</span>
            </div>

            <div id="tsm-approve"></div>

            <div class="tsm-note">
                One line per student, pasted straight from the
                spreadsheet so the columns stay tab separated.
                The student ID is the first column. Nothing is
                changed until you approve it.
                <br><br>
                Each tab keeps its own rows and its own report,
                so several windows can run different lists at
                the same time.
            </div>

            <label class="tsm-label" for="tsm-records">
                Spreadsheet rows
            </label>

            <textarea
                id="tsm-records"
                class="tsm-box tsm-tall"
                placeholder="ID &#9; first &#9; last &#9; email &#9; phone &#9; intl &#9; country &#9; permanent address &#9; term address &#9; contact name &#9; contact address &#9; contact number &#9; relationship"
            ></textarea>

            <label class="tsm-check">
                <input type="checkbox" id="tsm-dry-run">
                Dry run - report only, approve nothing
            </label>

            <button id="tsm-start-batch">
                START
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
                width: '400px',
                padding: '16px',
                background: '#151515',
                color: '#fff',
                border: '2px solid #555',
                borderRadius: '10px',
                zIndex: '2147483647',
                fontFamily: 'Arial, sans-serif',
                fontSize: '14px',
                boxShadow: '0 5px 20px rgba(0,0,0,0.5)',
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

        const recordInput = document.getElementById('tsm-records');

        panel.querySelectorAll('.tsm-box').forEach(
            box => {

                Object.assign(
                    box.style,
                    {
                        width: '100%',
                        boxSizing: 'border-box',
                        minHeight: box.classList.contains('tsm-tall')
                            ? '150px'
                            : '90px',
                        padding: '9px',
                        fontSize: '12px',
                        marginBottom: '4px',
                        resize: 'vertical',
                        borderRadius: '4px',
                        border: '1px solid #777',
                        background: '#fff',
                        color: '#000',
                        whiteSpace: 'pre',
                        overflowX: 'auto'
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

        const approve = document.getElementById('tsm-approve');

        Object.assign(
            approve.style,
            {
                display: 'none',
                marginTop: '12px',
                padding: '10px',
                background: '#20303f',
                border: '1px solid #4a7ea1',
                borderRadius: '5px'
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
                maxHeight: '360px',
                overflowY: 'auto'
            }
        );

        // ---- Restore what was entered last time ----

        const saved = loadSettings();

        if (typeof saved.records === 'string' && saved.records.trim()) {

            recordInput.value = saved.records;

        } else if (
            saved.run &&
            Array.isArray(saved.run.rows) &&
            saved.run.rows.length
        ) {

            // Last resort: the rows held by the batch itself.
            recordInput.value = saved.run.rows.join('\n');
        }

        // Paste goes through the tidier, so what lands in the
        // box is already one line per student.
        recordInput.addEventListener(
            'paste',
            event => {

                const clipboard =
                    event.clipboardData ||
                    window.clipboardData;

                if (!clipboard) {
                    return;
                }

                const text = clipboard.getData('text');

                if (!text) {
                    return;
                }

                event.preventDefault();

                const tidy = tidyRows(text);

                const start = recordInput.selectionStart;
                const end = recordInput.selectionEnd;

                const before = recordInput.value.slice(0, start);
                const after = recordInput.value.slice(end);

                const gap =
                    (before && !before.endsWith('\n')) ? '\n' : '';

                recordInput.value = before + gap + tidy + after;

                const caret = (before + gap + tidy).length;

                recordInput.setSelectionRange(caret, caret);

                recordInput.dispatchEvent(
                    new Event('input', { bubbles: true })
                );

                const count = tidy
                    ? tidy.split('\n').filter(Boolean).length
                    : 0;

                setStatus(
                    'Pasted ' +
                    count +
                    ' row(s), one line each.'
                );
            }
        );

        recordInput.addEventListener('input', () => {

            const text = recordInput.value;
            const previous = loadSettings().records;

            if (
                !text.trim() &&
                typeof previous === 'string' &&
                previous.trim()
            ) {

                setStatus(
                    'The rows box was cleared. The saved list is ' +
                    'still there - reload the page to get it back.'
                );

                return;
            }

            saveSetting('records', text);
        });

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

        // ---- Start ----

        const startButton =
            document.getElementById('tsm-start-batch');

        startButton.addEventListener(
            'click',
            async () => {

                if (processing) {
                    return;
                }

                // Tidy again in case the box was typed into
                // or pasted before this version.
                const tidied = tidyRows(recordInput.value);

                if (tidied !== recordInput.value) {

                    recordInput.value = tidied;

                    recordInput.dispatchEvent(
                        new Event('input', { bubbles: true })
                    );
                }

                const rows = tidied
                    .split('\n')
                    .map(line => line.replace(/\s+$/, ''))
                    .filter(line => line.trim());

                if (!rows.length) {

                    setStatus('⚠ Paste at least one row.', true);
                    recordInput.focus();
                    return;
                }

                const records = {};
                const studentIds = [];
                const problems = [];

                rows.forEach(
                    (line, index) => {

                        const parsed = parseRecord(line);

                        const studentId = parsed.studentId;

                        if (!studentId || !/^\d+$/.test(studentId)) {

                            problems.push(
                                'Line ' + (index + 1) +
                                ': first column is "' +
                                (studentId || 'empty') +
                                '", which is not a student ID.'
                            );

                            return;
                        }

                        if (records[studentId]) {

                            problems.push(
                                'Line ' + (index + 1) +
                                ': ' + studentId + ' appears twice.'
                            );

                            return;
                        }

                        records[studentId] = parsed;
                        studentIds.push(studentId);

                        parsed.problems.forEach(
                            note => problems.push(
                                studentId + ': ' + note
                            )
                        );

                        if (!parsed.tabbed) {

                            problems.push(
                                studentId +
                                ': no tabs in that line - empty ' +
                                'cells collapse and shift the columns.'
                            );
                        }
                    }
                );

                if (!studentIds.length) {

                    setStatus(
                        '⚠ No usable rows.\n\n' + problems.join('\n'),
                        true
                    );

                    return;
                }

                if (problems.length) {

                    const carryOn = window.confirm(
                        'Some rows did not read cleanly:\n\n' +
                        problems.join('\n') +
                        '\n\nCarry on anyway?'
                    );

                    if (!carryOn) {
                        return;
                    }
                }

                // What was read, so it can be checked at a glance.
                const preview = studentIds.slice(0, 3).map(
                    id => {

                        const r = records[id];

                        return (
                            id + '  ' + r.firstName + ' ' + r.lastName +
                            '\n    email   : ' + r.email +
                            '\n    phone   : ' + r.phone +
                            '\n    contact : ' + r.ecName +
                            ' / ' + r.ecNumber +
                            '\n    relation: ' + r.relationshipValue
                        );
                    }
                ).join('\n\n');

                const confirmation = window.confirm(
                    'START?\n\n' +
                    studentIds.length + ' student(s):\n\n' +
                    studentIds.join(', ') +
                    '\n\nRead from the first row(s):\n\n' +
                    preview +
                    '\n\nFor each student:\n\n' +
                    '1. Open Student Academic Record\n' +
                    '2. Report a finance hold, and stop if they\n' +
                    '   are not enrolled\n' +
                    '3. Context Menu → Person\n' +
                    '4. Compare email, phone, addresses and\n' +
                    '   emergency contact against the row\n' +
                    '5. Show you each change and wait for\n' +
                    '   APPLY or SKIP\n' +
                    '6. Save, then Main Menu → Academics → SAR\n\n' +
                    (CONFIG.dryRun
                        ? 'DRY RUN - differences are reported only.'
                        : 'Nothing is written without your approval.') +
                    '\n\nContinue?'
                );

                if (!confirmation) {
                    return;
                }

                startButton.disabled = true;

                saveSetting('lastReport', null);

                await processBatch(studentIds, { records, rows });
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

        setPanelHidden(saved.panelHidden === true, false);

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
    }

    // =========================================================
    // STATUS
    // =========================================================

    function setStatus(message, error = false) {

        const status = document.getElementById('tsm-status');

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

            // Built before endRun, so the recorded changes are
            // still there to merge in.
            const card = safeReportCard(results, true, studentIds);

            endRun();

            saveReport(card);

            setStatus(card);

            return;
        }

        setStatus(
            'The page reloaded mid-batch.\n\n' +
            'Resuming at student ' +
            studentIds[index] +
            ' (' +
            (index + 1) +
            ' of ' +
            studentIds.length +
            ')...'
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

        // Rebuild the parsed rows - they are not carried in
        // memory across a reload.
        const rows = Array.isArray(run.rows) ? run.rows : [];

        const records = {};

        for (const line of rows) {

            const parsed = parseRecord(line);

            if (parsed.studentId) {
                records[parsed.studentId] = parsed;
            }
        }

        if (!Object.keys(records).length) {

            setStatus(
                'The batch cannot resume - the pasted rows were ' +
                'not saved. Paste them again and press START.',
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
            { records, rows },
            index
        );
    }


    function start() {

        if (!isTopFrame) {
            return;
        }

        createPanel();

        console.log(
            'TSM Person Data Check Assistant v7.0 loaded.'
        );

        const run = loadRun();

        if (run) {

            resumeRun(run);

            return;
        }

        // No batch running: put the last report back rather
        // than leaving the panel reading "Ready".
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
