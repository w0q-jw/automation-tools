// ==UserScript==
// @name         TSM Withdrawal Assistant
// @namespace    Jaden-TSM
// @version      1.0
// @description  Batch TSM assistant for the withdrawals procedure - withdraws the current enrolment, updates the goal completion date and withdraws every registered course
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




    function askChoice(title, detail, buttons) {

        return new Promise(resolve => {

            const box = document.getElementById('tsmw-approve');

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


    async function setField(field, value) {

        if (!field) {
            return false;
        }

        await realMouseClick(field);

        await typeInto(field, value);

        field.dispatchEvent(new Event('change', { bubbles: true }));

        return true;
    }


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


    function findSaveButton() {

        return [
            ...document.querySelectorAll('button[data-save-button="true"]')
        ].filter(isVisible)[0] || null;
    }


    function isDirty() {

        const save = findSaveButton();

        return !!(save && save.classList.contains('saveDirty'));
    }


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
                    request,
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
                document.getElementById('tsmw-start-batch');

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
    // USER INTERFACE
    // =========================================================

    // Everything the panel remembers is stored PER TAB, so
    // several windows can work on different rows at once.
    // A single shared key meant whichever tab saved last won,
    // and the next reload pulled its rows - and its report -
    // into all the others.
    const STORAGE_KEY = 'tsmw-withdrawal-assistant';


    // The tab's identity. sessionStorage is per tab, and
    // window.name carries it as well so that clearing
    // sessionStorage mid-run cannot orphan the settings.
    const TAB_ID = (function () {

        const fresh = () => Math.random().toString(36).slice(2, 6);

        let id = '';

        try {
            id = window.sessionStorage.getItem('tsmw-withdrawal-tab-id') || '';
        } catch (error) {}

        if (!id) {

            try {

                const named = String(window.name || '');

                if (named.startsWith('tsmw-withdrawal-tab:')) {
                    id = named.slice('tsmw-withdrawal-tab:'.length);
                }

            } catch (error) {}
        }

        if (!id) {
            id = fresh();
        }

        try {
            window.sessionStorage.setItem('tsmw-withdrawal-tab-id', id);
        } catch (error) {}

        try {

            const named = String(window.name || '');

            // Never trample a name the site set for itself.
            if (!named || named.startsWith('tsmw-withdrawal-tab:')) {
                window.name = 'tsmw-withdrawal-tab:' + id;
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
        return document.getElementById('tsmw-reopen');
    }


    function ensureReopenButton() {

        if (reopenButton()) {
            return reopenButton();
        }

        const button = document.createElement('button');

        button.id = 'tsmw-reopen';
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
            ...document.querySelectorAll('#tsmw-batch-panel')
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




    function setStatus(message, error = false) {

        const status = document.getElementById('tsmw-status');

        const small = document.getElementById('tsmw-reopen');

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
    // WITHDRAWAL SETTINGS
    // =========================================================

    const REASONS = [
        'Other', 'Academic failure', 'Death', 'Exclusion',
        'Financial reasons', 'Employment', 'Health', 'Personal',
        'Transferred out', 'Transferred to', 'Unknown', 'Written off'
    ];

    const DEFAULTS = {
        year: '2026-27',
        startDate: '21/09/2026',
        lastDate: '28/09/2026',
        goalDate: '29/09/2026',
        reason: 'Other'
    };

    const COMMENT = 'Withdrawal by SRO.';

    // Processing time. TSM answers slowly after most actions, so
    // every step is followed by a pause before the next one.
    const PAUSE = {
        afterSection: 2500,     // after opening Enrolment / Goals
        afterExpand: 2000,      // after expanding the year row
        afterEditOpen: 2500,    // after the edit pencil
        afterTypeSelect: 2500,  // Withdrawn selected, new area appears
        afterField: 700,        // after each field is filled
        afterOk: 2000,          // after OK on an edit dialog
        afterSave: 8000,        // after every Save
        afterGoalSave: 4000,    // extra wait before the context menu
        afterCourseMenu: 2500,  // after the Student Course Enrolment page
        afterLines: 1200,       // after the lines icon opens its menu
        afterWithdrawClick: 2500, // for the comment box to appear
        afterComment: 1000,     // after typing the comment
        afterOverride: 3000,    // after pressing Override
        betweenCourses: 2000    // before the next course
    };


    let dialogsCleared = 0;

    // Set when the page reloaded after Override and the run
    // is picking up on the course page instead of going back
    // to the search.
    let resumeToCourses = false;

    function onCoursePage() {
        return /StudentCourseEnrol/i.test(window.location.href);
    }


    function getFact(name) {

        try {

            const run = loadSettings().run || {};
            const facts = run.facts || {};

            return (facts[currentStudentId] || {})[name];

        } catch (error) {

            return undefined;
        }
    }


    // =========================================================
    // SECTIONS OF THE STUDENT ACADEMIC RECORD
    // =========================================================

    function sectionVisible(kind) {

        if (kind === 'enrolment') {
            return isVisible(document.getElementById('enrollmentTable'));
        }

        return goalIcons().length > 0;
    }


    function goalIcons() {

        return [
            ...document.querySelectorAll('span.icon.editIcon')
        ].filter(
            icon =>
                isVisible(icon) &&
                /#Goals_\d+/.test(icon.getAttribute('onclick') || '')
        );
    }


    async function openSection(kind) {

        if (sectionVisible(kind)) {
            return;
        }

        const wanted = kind === 'enrolment'
            ? /^enrol{1,2}ment$/
            : /^(academic )?goals?$/;

        const rank = { A: 0, BUTTON: 1, LI: 2, H3: 3 };

        const candidates = () => [
            ...document.querySelectorAll('a, button, li, h3, span, div')
        ].filter(
            element =>
                isVisible(element) &&
                !element.closest('#tsmw-batch-panel') &&
                wanted.test(normalise(element.textContent))
        ).sort(
            (a, b) =>
                (rank[a.tagName] ?? 9) - (rank[b.tagName] ?? 9)
        );

        const tried = new Set();

        for (let attempt = 0; attempt < 4; attempt++) {

            checkStopped();

            const target = candidates().find(
                element => !tried.has(element)
            );

            if (!target) {
                break;
            }

            tried.add(target);

            await realMouseClick(target);

            try {

                await waitFor(
                    () => sectionVisible(kind),
                    6000,
                    'the ' + kind + ' section'
                );

                await sleep(PAUSE.afterSection);

                return;

            } catch (error) {}
        }

        throw new Error('Could not open the ' + kind + ' section.');
    }


    // If the section cannot be found automatically, the run stops
    // for you to open it, rather than guessing.
    async function ensureSection(kind, label) {

        try {

            await openSection(kind);

        } catch (error) {}

        while (!sectionVisible(kind)) {

            checkStopped();

            const answer = await askChoice(
                'Open the ' + label + ' section',
                [
                    'The script could not find the ' + label +
                    ' section on this page.',
                    '',
                    'Open it by hand, then press CONTINUE.'
                ],
                [
                    {
                        label: 'I HAVE OPENED IT - CONTINUE',
                        value: 'go',
                        background: '#1f5c2f'
                    },
                    {
                        label: 'SKIP THIS STUDENT',
                        value: 'skip',
                        background: '#5c1f1f'
                    }
                ]
            );

            if (answer === 'skip') {
                throw new Error(
                    'Skipped by you - the ' + label +
                    ' section could not be opened.'
                );
            }

            await sleep(1500);
        }

        await sleep(PAUSE.afterSection);
    }


    // =========================================================
    // FIELD HELPERS
    // =========================================================

    function chosenText(container) {

        const chosen = container &&
            container.querySelector('.select2-chosen');

        return normalise(chosen ? chosen.textContent : '');
    }


    async function waitForContainer(id, description) {

        return await waitFor(
            () => {

                const element = document.getElementById(id);

                return (element && isVisible(element)) ? element : null;
            },
            WAIT.editForm,
            description
        );
    }


    // Select2 single dropdown: type, Down, Enter, then read it back.
    async function pickFromSelect2(container, text, description) {

        const word = normalise(text).split(' ')[0];

        for (let attempt = 1; attempt <= 2; attempt++) {

            await driveSelect2(container, text, description);

            await sleep(PAUSE.afterField);

            if (chosenText(container).includes(word)) {
                return chosenText(container);
            }

            setStatus(
                'The ' + description + ' reads "' +
                chosenText(container) + '" - trying again...'
            );

            await sleep(1000);
        }

        throw new Error(
            'The ' + description + ' would not take "' + text +
            '" (it reads "' + chosenText(container) + '").'
        );
    }


    function fieldByName(name) {

        return [
            ...document.querySelectorAll('input, textarea')
        ].find(
            field => field.name === name && isVisible(field)
        ) || null;
    }


    async function setDateField(field, value, description) {

        if (!field) {
            throw new Error('The ' + description + ' field is missing.');
        }

        await realMouseClick(field);
        await typeInto(field, value);

        field.dispatchEvent(new Event('change', { bubbles: true }));

        // Close the date picker without touching the dialog.
        try {

            if (window.jQuery && window.jQuery.datepicker) {
                window.jQuery(field).datepicker('hide');
            }

        } catch (error) {}

        field.blur();

        await sleep(PAUSE.afterField);

        if (field.value.trim() !== value) {

            throw new Error(
                'The ' + description + ' reads "' + field.value +
                '" instead of ' + value + '.'
            );
        }
    }


    async function saveRecord(description) {

        await clearOpenDialog();

        const save = await waitFor(
            findSaveButton,
            WAIT.save,
            'the Save button'
        );

        setStatus('Saving ' + description + '...');

        await realMouseClick(save);

        // Processing time after every Save.
        await sleep(PAUSE.afterSave);

        const still = findSaveButton();

        if (still && still.classList.contains('saveDirty')) {

            setStatus(
                'Save pressed but the record still looks unsaved - ' +
                'pressing it once more...'
            );

            await realMouseClick(still);

            await sleep(PAUSE.afterSave);

            if (isDirty()) {

                return 'Save pressed - record still looks unsaved';
            }
        }

        return 'Saved';
    }


    // =========================================================
    // STEP 1 - ENROLMENT
    // =========================================================

    function yearRow(year) {

        const wanted = normalise(year);

        return [
            ...document.querySelectorAll(
                '#enrollmentTable tr[id^="Enrollment_"]'
            )
        ].filter(
            row =>
                /^Enrollment_\d+$/.test(row.id) &&
                !row.closest('.moreInfoRow')
        ).find(
            row => {

                const cell = row.querySelector('td[data-col-id="_Periods"]');

                return cell && normalise(cell.textContent).includes(wanted);
            }
        ) || null;
    }


    function childRows(parent) {

        const reveal = document.getElementById(parent.id + '_revealRowPeriod');

        if (!reveal) {
            return [];
        }

        return [
            ...reveal.querySelectorAll('tr[id^="Enrollment_"]')
        ].filter(
            row =>
                /^Enrollment_\d+$/.test(row.id) &&
                row.querySelector('span.icon.editIcon')
        );
    }


    async function withdrawEnrolment(request, applied) {

        await ensureSection('enrolment', 'Enrolment');

        const parent = yearRow(request.year);

        if (!parent) {
            throw new Error(
                'No ' + request.year + ' academic year row in Enrolment.'
            );
        }

        // Expand the parent row.
        if (!childRows(parent).some(isVisible)) {

            const toggle = parent.querySelector(
                'td[data-col-id="_Periods"] .rowReveal'
            );

            if (!toggle) {
                throw new Error('The year row has no expand control.');
            }

            await clickUntil({
                getElement: () => toggle,
                verify: () => childRows(parent).find(isVisible) || null,
                description: 'the ' + request.year + ' row to expand',
                verifyTimeout: WAIT.editForm
            });
        }

        await sleep(PAUSE.afterExpand);

        const children = childRows(parent).filter(isVisible);

        if (!children.length) {
            throw new Error('No child enrolment row under ' + request.year + '.');
        }

        const child = children.find(
            row => !normalise(row.textContent).includes('withdrawn')
        );

        if (!child) {

            recordEntry('notes', 'Enrolment was already Withdrawn.');

            return 'already withdrawn';
        }

        if (children.length > 1) {

            recordEntry(
                'notes',
                children.length + ' child enrolment rows under ' +
                request.year + ' - used the first not yet withdrawn.'
            );
        }

        const n = child.id.replace('Enrollment_', '');

        setStatus('Opening the child enrolment (' + child.id + ')...');

        const pencil = child.querySelector('span.icon.editIcon');

        await clickUntil({
            getElement: () => child.querySelector('span.icon.editIcon') || pencil,
            verify: () => {

                const box = document.getElementById(
                    's2id_Enrollment_' + n + '__Enrollment_EnrollmentTypeID'
                );

                return (box && isVisible(box)) ? box : null;
            },
            description: 'the enrolment edit form',
            verifyTimeout: WAIT.editForm
        });

        await sleep(PAUSE.afterEditOpen);

        // Enrolment Type -> Withdrawn
        const typeBox = await waitForContainer(
            's2id_Enrollment_' + n + '__Enrollment_EnrollmentTypeID',
            'the Enrolment Type dropdown'
        );

        setStatus('Setting Enrolment Type to Withdrawn...');

        await pickFromSelect2(typeBox, 'withdrawn', 'Enrolment Type');

        // The Withdraw area appears lower down.
        await sleep(PAUSE.afterTypeSelect);

        const startName = 'Enrollment[' + n + '].Enrollment.StartDate';
        const lastName = 'Enrollment[' + n + '].LastDateOfAttendance';

        await waitFor(
            () => fieldByName(startName),
            WAIT.editForm,
            'the Withdraw area'
        );

        // Untick System Maintains Load.
        const load = document.getElementById(
            'Enrollment_' + n + '__Enrollment_SystemFullTime'
        );

        if (load && load.checked) {

            setStatus('Unticking System Maintains Load...');

            await realMouseClick(load);
            await sleep(PAUSE.afterField);

            if (load.checked) {

                nativeClick(load);
                await sleep(PAUSE.afterField);
            }

            if (load.checked) {
                throw new Error('System Maintains Load would not untick.');
            }
        }

        await sleep(PAUSE.afterField);

        setStatus('Entering the dates...');

        await setDateField(
            fieldByName(startName),
            request.startDate,
            'Start Date'
        );

        await setDateField(
            fieldByName(lastName),
            request.lastDate,
            'Last Date Of Attendance'
        );

        // Reason
        const reasonBox = await waitForContainer(
            's2id_Enrollment_' + n + '__EnrollmentReasonTypeID',
            'the Reason dropdown'
        );

        setStatus('Choosing the reason: ' + request.reason + '...');

        const reasonRead = await pickFromSelect2(
            reasonBox,
            request.reason,
            'Withdrawal reason'
        );

        await sleep(PAUSE.afterField);

        await confirmDialogOk();

        await sleep(PAUSE.afterOk);

        const saved = await saveRecord('the enrolment');

        recordFact({ enrolDone: true });

        applied.push(
            'Enrolment withdrawn (' + request.startDate +
            ', last attendance ' + request.lastDate +
            ', reason "' + reasonRead + '") - ' + saved
        );

        recordEntry('applied', applied[applied.length - 1]);

        return 'withdrawn';
    }


    // =========================================================
    // STEP 2 - GOAL COMPLETION DATE
    // =========================================================

    async function updateGoal(request, applied) {

        await ensureSection('goals', 'Goals');

        const icons = goalIcons();

        if (!icons.length) {
            throw new Error('No goal found in the Goals section.');
        }

        const rows = icons.map(icon => {

            const id = (icon.getAttribute('onclick')
                .match(/#(Goals_\d+)/) || [])[1];

            const row = document.getElementById(id);

            return {
                icon,
                id,
                text: normalise(row ? row.textContent : '')
            };
        });

        let pick = null;

        const active = rows.filter(
            item => /\bactive\b/.test(item.text) && !/inactive/.test(item.text)
        );

        if (rows.length === 1) {

            pick = rows[0];

        } else if (active.length === 1) {

            pick = active[0];

        } else {

            const answer = await askChoice(
                'Which goal is the active one?',
                rows.map(
                    (item, index) =>
                        (index + 1) + '. ' + item.text.slice(0, 120)
                ),
                rows.map(
                    (item, index) => ({
                        label: 'GOAL ' + (index + 1),
                        value: index
                    })
                )
            );

            pick = rows[answer];
        }

        const id = pick.id;

        setStatus('Opening the active goal (' + id + ')...');

        const fieldName = 'Goals[' + id.replace('Goals_', '') +
            '].StudentAcademicGoal.CompletionDate';

        await clickUntil({
            getElement: () => goalIcons().find(
                icon => (icon.getAttribute('onclick') || '')
                    .includes('#' + id + "'")
            ) || pick.icon,
            verify: () => fieldByName(fieldName),
            description: 'the goal edit form',
            verifyTimeout: WAIT.editForm
        });

        await sleep(PAUSE.afterEditOpen);

        const field = fieldByName(fieldName);

        if (field.value.trim() === request.goalDate) {

            recordEntry(
                'notes',
                'Goal completion date was already ' + request.goalDate + '.'
            );

            await confirmDialogOk();

            recordFact({ goalDone: true });

            return 'already set';
        }

        const before = field.value.trim();

        setStatus('Changing the goal completion date...');

        await setDateField(field, request.goalDate, 'Completion Date');

        await confirmDialogOk();

        await sleep(PAUSE.afterOk);

        const saved = await saveRecord('the goal');

        // "Save again, wait a bit, then the context menu."
        await sleep(PAUSE.afterGoalSave);

        recordFact({ goalDone: true });

        applied.push(
            'Goal completion date ' + (before || '(blank)') +
            ' → ' + request.goalDate + ' - ' + saved
        );

        recordEntry('applied', applied[applied.length - 1]);

        return 'updated';
    }


    // =========================================================
    // STEP 3 - WITHDRAW EVERY REGISTERED COURSE
    // =========================================================

    function courseLinkPath() {
        return 'StudentContextCourseEnrollment';
    }


    function coursePageLoaded() {

        return (
            /CourseEnrollment/i.test(window.location.href) ||
            [...document.querySelectorAll('span.itemContextIcon')]
                .some(isVisible)
        );
    }


    function withdrawButtons() {

        return [
            ...document.querySelectorAll(
                'button[data-dialog-callback="withdrawCourse"]'
            )
        ];
    }


    function findWithdrawButton(title) {

        return withdrawButtons().find(
            button => button.getAttribute('data-dialog-title') === title
        ) || null;
    }


    function commentBox() {

        return [
            ...document.querySelectorAll('textarea[name="Comment"]')
        ].find(isVisible) || null;
    }


    function findOverrideButton() {

        return [
            ...document.querySelectorAll('button.okButton')
        ].find(
            button =>
                isVisible(button) &&
                !button.disabled &&
                normalise(button.textContent) === 'override'
        ) || null;
    }


    async function withdrawOneCourse(title) {

        const button = findWithdrawButton(title);

        if (!button) {
            throw new Error('Withdraw option for "' + title + '" is gone.');
        }

        const icon = button.closest('span.itemContextIcon');

        if (!icon) {
            throw new Error('No lines icon found for "' + title + '".');
        }

        icon.scrollIntoView({ behavior: 'instant', block: 'center' });

        await sleep(500);

        // Press the four lines so its menu appears.
        await realMouseClick(icon);

        await sleep(PAUSE.afterLines);

        // Press Withdraw - retrying (reopening the menu) until the
        // comment box shows.
        await clickUntil({
            getElement: () => findWithdrawButton(title),
            verify: commentBox,
            description: 'the withdraw dialog for ' + title,
            verifyTimeout: 8000,
            beforeRetry: async () => {

                const again = findWithdrawButton(title);
                const lines = again && again.closest('span.itemContextIcon');

                if (lines) {

                    await realMouseClick(lines);
                    await sleep(PAUSE.afterLines);
                }
            }
        });

        await sleep(PAUSE.afterWithdrawClick);

        const box = commentBox();

        if (!box) {
            throw new Error('The comment box did not appear.');
        }

        await realMouseClick(box);
        await typeInto(box, COMMENT);

        box.dispatchEvent(new Event('change', { bubbles: true }));
        box.dispatchEvent(new Event('blur', { bubbles: true }));

        await sleep(PAUSE.afterComment);

        const override = await waitFor(
            findOverrideButton,
            WAIT.okButton,
            'the Override button'
        );

        await realMouseClick(override);

        // Processing time after Override.
        await sleep(PAUSE.afterOverride);

        try {

            await waitFor(
                () => commentBox() ? null : true,
                20000,
                'the withdraw dialog to close'
            );

        } catch (error) {

            throw new Error(
                'The withdraw dialog stayed open after Override ' +
                '(a validation message may be showing).'
            );
        }

        await sleep(PAUSE.betweenCourses);
    }


    async function withdrawCourses(applied) {

        if (onCoursePage() && coursePageLoaded()) {

            setStatus('On the course page - carrying on with the courses...');

        } else {

            await openContextMenu();

            setStatus('Opening Student Course Enrolment...');

            await clickUntil({
                getElement: () => findLinkInFlyout(
                    courseLinkPath(),
                    'student course enrolment'
                ),
                verify: coursePageLoaded,
                description: 'the Student Course Enrolment page',
                verifyTimeout: WAIT.personPage,
                beforeRetry: async () => {

                    try {
                        await openContextMenu();
                    } catch (error) {}
                }
            });

            await sleep(PAUSE.afterCourseMenu);
        }

        // Override reloads the page, so the script restarts and
        // comes back here. What is left to do is read from the
        // page itself: a withdrawn course loses its Withdraw
        // option. The set below only stops one title looping
        // within a single page load.
        const attempted = new Set();

        let count = 0;

        for (let guard = 0; guard < 60; guard++) {

            checkStopped();

            const next = withdrawButtons().find(
                button => !attempted.has(
                    button.getAttribute('data-dialog-title')
                )
            );

            if (!next) {
                break;
            }

            const title = next.getAttribute('data-dialog-title');

            const code = title.replace(/^Confirm Withdraw of\s*/i, '');

            attempted.add(title);

            // Written BEFORE the Override: if the page reloads,
            // the report still shows which course was in hand.
            recordFact({ lastCourse: code });

            setStatus(
                'Withdrawing course: ' + code +
                ' (' + (count + 1) + ' this page load)'
            );

            await withdrawOneCourse(title);

            count++;

            recordFact({ coursesAny: true });

            applied.push('Course withdrawn: ' + code);

            recordEntry('applied', 'Course withdrawn: ' + code);
        }

        if (!count && !getFact('coursesAny')) {

            recordEntry(
                'notes',
                'No courses with a Withdraw option were found.'
            );

            return 0;
        }

        // Save if the page is asking for it; a reload may have
        // already stored everything.
        const save = await waitFor(
            findSaveButton,
            6000,
            'the Save button'
        ).catch(() => null);

        if (save) {

            const saved = await saveRecord('the course withdrawals');

            applied.push('Course page saved - ' + saved);

            recordEntry('applied', 'Course page saved - ' + saved);

        } else {

            await sleep(PAUSE.afterSave);
        }

        return count;
    }


    // =========================================================
    // ONE STUDENT
    // =========================================================

    async function processStudent(studentId, request) {

        dialogsCleared = 0;
        currentStudentId = studentId;

        recordFact({ studentId, started: true });

        setStatus('Processing student ' + studentId);

        const applied = [];

        const pickUpOnCourses = resumeToCourses && onCoursePage();

        resumeToCourses = false;

        if (!pickUpOnCourses) {

            await searchStudent(studentId);

            await openStudentRecord(studentId);

            await sleep(PAUSE.afterSection);
        }

        // Steps already done before a page reload are not repeated.
        if (pickUpOnCourses) {

            setStatus('Page reloaded after Override - continuing with the courses.');

        } else if (!getFact('enrolDone')) {

            await withdrawEnrolment(request, applied);

            recordFact({ enrolDone: true });

        } else {

            setStatus('Enrolment already withdrawn - moving on.');
        }

        if (pickUpOnCourses) {

            // Goal and enrolment were done before the courses.

        } else if (!getFact('goalDone')) {

            await updateGoal(request, applied);

        } else {

            setStatus('Goal already updated - moving on.');
        }

        if (!getFact('coursesFinished')) {

            // A reload during the courses resumes on this page.
            markStage(studentId, 'courses');

            await withdrawCourses(applied);

            recordFact({ coursesFinished: true });
        }

        recordFact({ status: 'Withdrawn' });

        markStage(studentId, 'processed');
        advanceRun(studentId);

        setStatus(
            '✓ STUDENT COMPLETE\n\n' + studentId + '\n' +
            applied.join('\n')
        );

        await sleep(DELAY.beforeReturn);

        await returnToSAR();

        return {
            studentId,
            status: 'Withdrawn',
            applied,
            skipped: [],
            notes: []
        };
    }


    async function runStudentWithRetries(studentId, request) {

        try {

            return await processStudent(studentId, request);

        } catch (error) {

            currentStudentId = studentId;

            recordEntry('failed', error.message);

            throw error;
        }
    }



    // =========================================================
    // PANEL
    // =========================================================

    function createPanel() {

        if (document.getElementById('tsmw-batch-panel')) {
            return;
        }

        const saved = loadSettings();
        const form = saved.form || {};

        const value = (name) => (
            typeof form[name] === 'string' && form[name]
                ? form[name]
                : DEFAULTS[name]
        );

        const panel = document.createElement('div');

        panel.id = 'tsmw-batch-panel';

        panel.innerHTML = `
            <div class="tsmw-title">
                TSM Withdrawal Assistant
                <span class="tsmw-tab">tab ${TAB_ID}</span>
            </div>

            <div id="tsmw-approve"></div>

            <div class="tsmw-note">
                Paste the Student IDs, one per line. For each student
                the script withdraws the current-year enrolment, sets
                the goal completion date, then withdraws every
                registered course with the comment
                "${COMMENT}".
            </div>

            <label class="tsmw-label" for="tsmw-ids">Student IDs</label>
            <textarea id="tsmw-ids" class="tsmw-box"
                placeholder="One Student ID per line"></textarea>

            <label class="tsmw-label" for="tsmw-reason">Withdrawal reason</label>
            <select id="tsmw-reason" class="tsmw-input">
                ${REASONS.map(
                    reason => '<option>' + reason + '</option>'
                ).join('')}
            </select>

            <label class="tsmw-label" for="tsmw-year">Academic year</label>
            <input id="tsmw-year" class="tsmw-input" type="text"
                value="${value('year')}">

            <label class="tsmw-label" for="tsmw-start">
                Start Date (enrolment)
            </label>
            <input id="tsmw-start" class="tsmw-input" type="text"
                value="${value('startDate')}">

            <label class="tsmw-label" for="tsmw-last">
                Last Date Of Attendance (completion date)
            </label>
            <input id="tsmw-last" class="tsmw-input" type="text"
                value="${value('lastDate')}">

            <label class="tsmw-label" for="tsmw-goal">
                Goal Completion Date (withdrawal date)
            </label>
            <input id="tsmw-goal" class="tsmw-input" type="text"
                value="${value('goalDate')}">

            <button id="tsmw-start-batch">START</button>
            <button id="tsmw-stop">STOP</button>
            <button id="tsmw-hide">HIDE PANEL</button>

            <div id="tsmw-status">Ready</div>
        `;

        Object.assign(panel.style, {
            position: 'fixed',
            top: '20px',
            right: '20px',
            width: '380px',
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
        });

        document.body.appendChild(panel);

        Object.assign(panel.querySelector('.tsmw-title').style, {
            fontWeight: 'bold',
            fontSize: '18px',
            marginBottom: '14px'
        });

        Object.assign(panel.querySelector('.tsmw-tab').style, {
            float: 'right',
            padding: '2px 8px',
            background: '#333',
            border: '1px solid #666',
            borderRadius: '10px',
            fontSize: '11px',
            fontWeight: 'normal'
        });

        Object.assign(panel.querySelector('.tsmw-note').style, {
            margin: '0 0 12px 0',
            padding: '8px',
            background: '#242424',
            borderLeft: '3px solid #777',
            borderRadius: '3px',
            fontSize: '12px',
            lineHeight: '1.5'
        });

        panel.querySelectorAll('.tsmw-label').forEach(label => {
            Object.assign(label.style, {
                display: 'block',
                marginTop: '10px',
                marginBottom: '5px',
                fontWeight: 'bold',
                fontSize: '12px'
            });
        });

        panel.querySelectorAll('.tsmw-box, .tsmw-input').forEach(box => {
            Object.assign(box.style, {
                width: '100%',
                boxSizing: 'border-box',
                padding: '8px',
                fontSize: '13px',
                borderRadius: '4px',
                border: '1px solid #777',
                background: '#fff',
                color: '#000'
            });
        });

        Object.assign(document.getElementById('tsmw-ids').style, {
            minHeight: '110px',
            resize: 'vertical'
        });

        panel.querySelectorAll('button').forEach(button => {
            Object.assign(button.style, {
                width: '100%',
                padding: '10px',
                marginTop: '7px',
                cursor: 'pointer',
                fontWeight: 'bold'
            });
        });

        Object.assign(document.getElementById('tsmw-approve').style, {
            display: 'none',
            marginTop: '12px',
            padding: '10px',
            background: '#20303f',
            border: '1px solid #4a7ea1',
            borderRadius: '5px'
        });

        Object.assign(document.getElementById('tsmw-status').style, {
            marginTop: '12px',
            padding: '10px',
            background: '#292929',
            borderRadius: '5px',
            fontSize: '12px',
            lineHeight: '1.5',
            whiteSpace: 'pre-line',
            maxHeight: '360px',
            overflowY: 'auto'
        });

        // ---- Restore what was entered last time ----

        const idsBox = document.getElementById('tsmw-ids');
        const reason = document.getElementById('tsmw-reason');

        const inputs = {
            year: document.getElementById('tsmw-year'),
            startDate: document.getElementById('tsmw-start'),
            lastDate: document.getElementById('tsmw-last'),
            goalDate: document.getElementById('tsmw-goal')
        };

        if (typeof saved.ids === 'string') {
            idsBox.value = saved.ids;
        } else if (saved.run && Array.isArray(saved.run.studentIds)) {
            idsBox.value = saved.run.studentIds.join('\n');
        }

        reason.value = REASONS.includes(form.reason)
            ? form.reason
            : DEFAULTS.reason;

        const saveForm = () => {

            saveSetting('form', {
                reason: reason.value,
                year: inputs.year.value,
                startDate: inputs.startDate.value,
                lastDate: inputs.lastDate.value,
                goalDate: inputs.goalDate.value
            });
        };

        idsBox.addEventListener('input', () => {
            saveSetting('ids', idsBox.value);
        });

        reason.addEventListener('change', saveForm);

        Object.values(inputs).forEach(
            input => input.addEventListener('input', saveForm)
        );

        // ---- Start ----

        const startButton = document.getElementById('tsmw-start-batch');

        startButton.addEventListener('click', async () => {

            if (processing) {
                return;
            }

            const studentIds = parseStudentIDs(idsBox.value);

            if (!studentIds.length) {

                setStatus('⚠ Enter at least one Student ID.', true);
                idsBox.focus();
                return;
            }

            const request = {
                reason: reason.value,
                year: inputs.year.value.trim(),
                startDate: inputs.startDate.value.trim(),
                lastDate: inputs.lastDate.value.trim(),
                goalDate: inputs.goalDate.value.trim()
            };

            const dateOk = text => /^\d{2}\/\d{2}\/\d{4}$/.test(text);

            if (
                !request.year ||
                !dateOk(request.startDate) ||
                !dateOk(request.lastDate) ||
                !dateOk(request.goalDate)
            ) {

                setStatus(
                    '⚠ Dates must be DD/MM/YYYY and the academic year ' +
                    'must be filled in.',
                    true
                );
                return;
            }

            const confirmation = window.confirm(
                'Withdraw ' + studentIds.length + ' student(s)?\n\n' +
                'Reason: ' + request.reason + '\n' +
                'Year: ' + request.year + '\n' +
                'Start Date: ' + request.startDate + '\n' +
                'Last Date Of Attendance: ' + request.lastDate + '\n' +
                'Goal Completion Date: ' + request.goalDate + '\n\n' +
                'Every registered course is withdrawn too.\n\nContinue?'
            );

            if (!confirmation) {
                return;
            }

            startButton.disabled = true;

            saveSetting('lastReport', null);
            saveSetting('ids', idsBox.value);
            saveForm();

            await processBatch(studentIds, request);
        });

        // ---- Hide ----

        const hideButton = document.getElementById('tsmw-hide');

        Object.assign(hideButton.style, {
            background: '#2a2a2a',
            color: '#ddd',
            border: '1px solid #666'
        });

        hideButton.addEventListener('click', () => setPanelHidden(true));

        ensureReopenButton();

        setPanelHidden(saved.panelHidden === true, false);

        document.addEventListener('keydown', event => {

            if (
                event.ctrlKey && event.shiftKey &&
                (event.key === 'H' || event.key === 'h')
            ) {

                event.preventDefault();

                const box = document.getElementById('tsmw-batch-panel');

                setPanelHidden(!box || box.style.display !== 'none');
            }
        });

        // ---- Stop ----

        document.getElementById('tsmw-stop').addEventListener('click', () => {

            if (!processing) {
                return;
            }

            stopped = true;

            endRun();

            setStatus(
                'STOP REQUESTED\n\nThe current operation will stop safely.',
                true
            );
        });
    }


    // =========================================================
    // RESUME AFTER A PAGE RELOAD
    // =========================================================

    async function resumeRun(run) {

        const studentIds = run.studentIds;
        const current = run.current || {};

        let index = run.index || 0;

        if (
            current.stage === 'processed' &&
            String(studentIds[index]) === String(current.studentId)
        ) {
            index++;
        }

        if (index >= studentIds.length) {

            const results = Array.isArray(run.results) ? run.results : [];

            const card = safeReportCard(results, true, studentIds);

            endRun();
            saveReport(card);
            setStatus(card);

            return;
        }

        setStatus(
            'The page reloaded mid-batch.\n\nResuming at student ' +
            studentIds[index] + ' (' + (index + 1) + ' of ' +
            studentIds.length + ')...'
        );

        const startButton = document.getElementById('tsmw-start-batch');

        if (startButton) {
            startButton.disabled = true;
        }

        const request = run.request;

        if (!request || !request.goalDate) {

            setStatus(
                'The batch cannot resume - its settings were not saved. ' +
                'Press START again.',
                true
            );

            endRun();

            if (startButton) {
                startButton.disabled = false;
            }

            return;
        }

        await sleep(DELAY.beforeResume);

        // Reloaded by Override part-way through the courses:
        // stay on the course page and carry on.
        if (
            current.stage === 'courses' &&
            String(studentIds[index]) === String(current.studentId) &&
            onCoursePage()
        ) {

            try {

                await waitFor(
                    coursePageLoaded,
                    30000,
                    'the course page after the reload'
                );

                await sleep(PAUSE.afterCourseMenu);

                resumeToCourses = true;

                await processBatch(studentIds, request, index);

                return;

            } catch (error) {

                resumeToCourses = false;
            }
        }

        try {

            if (!searchBox()) {
                await returnToSAR();
            }

        } catch (error) {

            setStatus(
                'Could not get back to the SAR search to resume.\n\n' +
                'Press START when the search page is up.',
                true
            );

            endRun();

            if (startButton) {
                startButton.disabled = false;
            }

            return;
        }

        await processBatch(studentIds, request, index);
    }


    // =========================================================
    // START
    // =========================================================

    function start() {

        if (!isTopFrame) {
            return;
        }

        createPanel();

        console.log('TSM Withdrawal Assistant v1.0 loaded.');

        const run = loadRun();

        if (run) {

            resumeRun(run);

            return;
        }

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
