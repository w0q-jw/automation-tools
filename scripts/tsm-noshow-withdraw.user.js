// ==UserScript==
// @name         TSM No Show and Withdraw Assistant
// @namespace    Jaden-TSM
// @version      1.0
// @description  Batch TSM assistant - students who have not completed the enrolment form: new students made No Show, returning students made Withdrawn, with the goal, Enrolment Status and finance note updated
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

            const box = document.getElementById('tsmn-approve');

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
                document.getElementById('tsmn-start-batch');

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
    const STORAGE_KEY = 'tsmn-noshow-assistant';


    // The tab's identity. sessionStorage is per tab, and
    // window.name carries it as well so that clearing
    // sessionStorage mid-run cannot orphan the settings.
    const TAB_ID = (function () {

        const fresh = () => Math.random().toString(36).slice(2, 6);

        let id = '';

        try {
            id = window.sessionStorage.getItem('tsmn-noshow-tab-id') || '';
        } catch (error) {}

        if (!id) {

            try {

                const named = String(window.name || '');

                if (named.startsWith('tsmn-noshow-tab:')) {
                    id = named.slice('tsmn-noshow-tab:'.length);
                }

            } catch (error) {}
        }

        if (!id) {
            id = fresh();
        }

        try {
            window.sessionStorage.setItem('tsmn-noshow-tab-id', id);
        } catch (error) {}

        try {

            const named = String(window.name || '');

            // Never trample a name the site set for itself.
            if (!named || named.startsWith('tsmn-noshow-tab:')) {
                window.name = 'tsmn-noshow-tab:' + id;
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
        return document.getElementById('tsmn-reopen');
    }


    function ensureReopenButton() {

        if (reopenButton()) {
            return reopenButton();
        }

        const button = document.createElement('button');

        button.id = 'tsmn-reopen';
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
            ...document.querySelectorAll('#tsmn-batch-panel')
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

        const status = document.getElementById('tsmn-status');

        const small = document.getElementById('tsmn-reopen');

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
    // NO SHOW / WITHDRAWN SETTINGS
    //
    // New student (no enrolment rows):       No Show
    // Returning student (enrolment rows):    Withdrawn
    // =========================================================

    function todayStamp() {

        const now = new Date();
        const pad = value => String(value).padStart(2, '0');

        return pad(now.getDate()) + '.' + pad(now.getMonth() + 1) + '.' +
            String(now.getFullYear()).slice(-2);
    }


    const DEFAULTS = {
        previousYear: '2025-26',
        returningPeriod: '2025 September',
        returningDate: '31/08/2026',
        newPeriod: '2026 September',
        noteDate: todayStamp(),
        initials: 'J4S'
    };


    function newStudentNote(request) {
        return request.noteDate + ' - Student has not enrolled by agreed ' +
            'University deadline and has been made No Show – ' + request.initials;
    }


    function returningStudentNote(request) {
        return request.noteDate + '. Student has not enrolled by agreed ' +
            'University deadline and has been made Withdrawn. ' + request.initials;
    }


    const PAUSE = {
        afterSection: 2000,
        afterExpand: 2000,
        afterEditOpen: 2500,   // an edit dialog opening
        afterSelect: 1200,     // a dropdown value taking
        afterCombo: 1500,      // the period list appearing
        afterField: 700,
        afterOk: 2000,         // a dialog closing
        afterSave: 8000        // every Save
    };


    let dialogsCleared = 0;


    function getFact(name) {

        try {

            const run = loadSettings().run || {};

            return ((run.facts || {})[currentStudentId] || {})[name];

        } catch (error) {

            return undefined;
        }
    }


    function applied(text) {

        recordEntry('applied', text);

        setStatus('✓ ' + text);
    }


    function note(text) {

        recordEntry('notes', text);

        setStatus(text);
    }


    function cleanText(value) {

        return String(value || '').replace(/\s+/g, ' ').trim();
    }


    // =========================================================
    // DIALOGS AND DROPDOWNS
    // =========================================================

    function topDialog() {

        const dialogs = [
            ...document.querySelectorAll('.ui-dialog')
        ].filter(isVisible);

        if (!dialogs.length) {
            return null;
        }

        return dialogs.sort(
            (a, b) =>
                (Number(getComputedStyle(b).zIndex) || 0) -
                (Number(getComputedStyle(a).zIndex) || 0)
        )[0];
    }


    // The select2 that belongs to a label, inside the dialog.
    function select2ByLabel(scope, pattern) {

        if (!scope) {
            return null;
        }

        const labels = [...scope.querySelectorAll('label')].filter(
            label => pattern.test(normalise(label.textContent))
        );

        for (const label of labels) {

            const target = label.getAttribute('for');

            if (target) {

                const byId = document.getElementById('s2id_' + target);

                if (byId) {
                    return byId;
                }
            }

            let node = label.parentElement;

            for (let depth = 0; node && depth < 4; depth++) {

                const container = node.querySelector('.select2-container');

                if (container) {
                    return container;
                }

                node = node.parentElement;
            }
        }

        return null;
    }


    function select2Text(container) {

        const chosen = container && container.querySelector('.select2-chosen');

        return cleanText(chosen ? chosen.textContent : '');
    }


    function select2SearchBox() {

        return [
            ...document.querySelectorAll(
                '.select2-drop-active input.select2-input, ' +
                '#select2-drop input.select2-input, ' +
                'input.select2-input'
            )
        ].find(isVisible) || null;
    }


    function select2Results() {

        return [
            ...document.querySelectorAll(
                '.select2-drop-active .select2-result-selectable, ' +
                '#select2-drop .select2-result-selectable'
            )
        ].filter(isVisible);
    }


    // Type the value, then pick it: the exact result is clicked
    // when it can be seen, otherwise Down + Enter as by hand.
    // The choice is always read back.
    async function chooseSelect2(container, text, description) {

        const wanted = normalise(text);

        if (normalise(select2Text(container)) === wanted) {
            return 'already ' + text;
        }

        for (let attempt = 1; attempt <= 3; attempt++) {

            checkStopped();

            await realMouseClick(
                container.querySelector('a.select2-choice') || container
            );

            const box = await waitFor(
                select2SearchBox,
                WAIT.okButton,
                'the ' + description + ' search box'
            );

            await typeInto(box, text);

            await sleep(PAUSE.afterSelect);

            const exact = select2Results().find(
                item => normalise(item.textContent) === wanted
            );

            if (attempt < 3 && exact) {

                await realMouseClick(
                    exact.querySelector('.select2-result-label') || exact
                );

            } else {

                if (attempt !== 2) {

                    box.dispatchEvent(new KeyboardEvent('keydown', {
                        key: 'ArrowDown', code: 'ArrowDown',
                        keyCode: 40, which: 40, bubbles: true
                    }));

                    await sleep(300);
                }

                pressEnter(box);
            }

            await sleep(PAUSE.afterSelect);

            if (normalise(select2Text(container)) === wanted) {
                return 'set to ' + text;
            }

            if (select2SearchBox()) {
                pressEscape();
                await sleep(500);
            }
        }

        throw new Error(
            'The ' + description + ' would not take "' + text +
            '" (it reads "' + select2Text(container) + '").'
        );
    }


    // The Completion Period box: a type-to-search list. Type,
    // then pick the matching entry (or Down + Enter).
    function autocompleteItems() {

        return [
            ...document.querySelectorAll(
                'ul.ui-autocomplete li, ul.ui-menu li.ui-menu-item'
            )
        ].filter(isVisible);
    }


    async function fillCombobox(field, text, description) {

        const wanted = normalise(text);

        if (normalise(field.value) === wanted) {
            return 'already ' + text;
        }

        for (let attempt = 1; attempt <= 3; attempt++) {

            checkStopped();

            await realMouseClick(field);
            await typeInto(field, text);

            await sleep(PAUSE.afterCombo);

            let items = autocompleteItems();

            // Ask the list to search if typing alone did not.
            if (!items.length) {

                try {

                    if (window.jQuery) {
                        window.jQuery(field).autocomplete('search', text);
                    }

                } catch (error) {}

                await sleep(PAUSE.afterCombo);

                items = autocompleteItems();
            }

            const exact = items.find(
                item => normalise(item.textContent) === wanted
            );

            if (attempt < 3 && exact) {

                await realMouseClick(
                    exact.querySelector('a, div') || exact
                );

            } else {

                field.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'ArrowDown', code: 'ArrowDown',
                    keyCode: 40, which: 40, bubbles: true
                }));

                await sleep(300);

                pressEnter(field);
            }

            await sleep(PAUSE.afterField);

            field.dispatchEvent(new Event('change', { bubbles: true }));

            if (normalise(field.value) === wanted) {
                return 'set to ' + text;
            }
        }

        throw new Error(
            'The ' + description + ' would not take "' + text +
            '" (it reads "' + field.value + '").'
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


    function addOneDay(text) {

        const match = String(text || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);

        if (!match) {
            return '';
        }

        const date = new Date(
            Number(match[3]), Number(match[2]) - 1, Number(match[1]) + 1
        );

        const pad = value => String(value).padStart(2, '0');

        return pad(date.getDate()) + '/' + pad(date.getMonth() + 1) + '/' +
            date.getFullYear();
    }


    function editIconFor(rowId) {

        return [
            ...document.querySelectorAll('span.icon.editIcon')
        ].find(
            icon => {

                const onclick = icon.getAttribute('onclick') || '';

                return (
                    onclick.includes("$('#" + rowId + "')") ||
                    onclick.includes('$("#' + rowId + '")')
                );
            }
        ) || null;
    }


    async function openRowEditor(rowId, verify, description) {

        await clickUntil({
            getElement: () => editIconFor(rowId),
            verify,
            description,
            verifyTimeout: WAIT.editForm
        });

        await sleep(PAUSE.afterEditOpen);
    }


    async function pressDialogOk(description) {

        const ok = await waitFor(
            findOkButton,
            WAIT.okButton,
            'the OK button on ' + description
        );

        await realMouseClick(ok);

        try {

            await waitFor(
                () => (!ok.isConnected || !isVisible(ok)) ? true : null,
                WAIT.okButton,
                description + ' to close'
            );

        } catch (error) {

            throw new Error(
                description + ' stayed open after OK - a required ' +
                'field or validation message may be showing.'
            );
        }

        await sleep(PAUSE.afterOk);
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

        if (still && isVisible(still) && still.classList.contains('saveDirty')) {

            setStatus('Save pressed but the record still looks unsaved - pressing it again...');

            await realMouseClick(still);

            await sleep(PAUSE.afterSave);

            if (isDirty()) {
                return 'Save pressed - record still looks unsaved';
            }
        }

        return 'Saved';
    }


    // Adds the note to a notes box, keeping anything already
    // written there.
    async function addNote(box, text, description) {

        const current = box.value.replace(/\s+$/, '');

        if (normalise(current).includes(normalise(text))) {
            return 'already there';
        }

        const value = current ? current + '\n' + text : text;

        if (value.length > 2000) {
            throw new Error('The ' + description + ' would go over 2000 characters.');
        }

        await realMouseClick(box);

        box.value = value;

        for (const type of ['input', 'keyup', 'change']) {
            box.dispatchEvent(new Event(type, { bubbles: true }));
        }

        box.blur();

        await sleep(PAUSE.afterField);

        if (!normalise(box.value).includes(normalise(text))) {
            throw new Error('The note did not stay in the ' + description + '.');
        }

        return current ? 'added below the existing notes' : 'added';
    }


    function notesBox(label) {

        const dialog = topDialog() || document;

        return [
            ...dialog.querySelectorAll('textarea')
        ].find(
            box =>
                isVisible(box) &&
                normalise(box.getAttribute('data-label') || '') === normalise(label)
        ) || null;
    }


    // =========================================================
    // NEW OR RETURNING
    // =========================================================

    function parentEnrolmentRows() {

        const table = document.getElementById('enrollmentTable');

        if (!table) {
            return null;
        }

        return [
            ...table.querySelectorAll('tr[id^="Enrollment_"]')
        ].filter(
            row =>
                /^Enrollment_\d+$/.test(row.id) &&
                !row.closest('.moreInfoRow')
        );
    }


    async function readStudentType() {

        const rows = await waitFor(
            () => parentEnrolmentRows(),
            WAIT.studentRecord,
            'the Enrolment section'
        );

        // A moment for the table to finish filling in.
        await sleep(1500);

        return (parentEnrolmentRows() || rows).length ? 'returning' : 'new';
    }


    // =========================================================
    // STEP 1 - GOAL
    // =========================================================

    function goalRows() {

        return [
            ...document.querySelectorAll('span.icon.editIcon')
        ].map(
            icon => {

                const id = ((icon.getAttribute('onclick') || '')
                    .match(/#(Goals_\d+)['"]/) || [])[1];

                const row = id ? document.getElementById(id) : null;

                return id ? {
                    id,
                    index: id.replace('Goals_', ''),
                    text: normalise(row ? row.textContent : '')
                } : null;
            }
        ).filter(Boolean);
    }


    async function pickGoal() {

        const goals = goalRows();

        if (!goals.length) {
            throw new Error('No goal found in the Goals section.');
        }

        if (goals.length === 1) {
            return goals[0];
        }

        const live = goals.filter(
            goal => !/withdrawn|completed|graduated/.test(goal.text)
        );

        if (live.length === 1) {
            return live[0];
        }

        const answer = await askChoice(
            'Which goal should be withdrawn?',
            goals.map(
                (goal, index) => (index + 1) + '. ' + goal.text.slice(0, 120)
            ),
            goals.map(
                (goal, index) => ({ label: 'GOAL ' + (index + 1), value: index })
            ).concat([{
                label: 'SKIP THIS STUDENT',
                value: 'skip',
                background: '#5c1f1f'
            }])
        );

        if (answer === 'skip') {
            throw new Error('Skipped by you - more than one goal.');
        }

        return goals[answer];
    }


    async function updateGoal(type, request) {

        const goal = await pickGoal();

        const n = goal.index;

        const standingBox = () => select2ByLabel(topDialog(), /^standing/);

        setStatus('Opening the goal (' + goal.id + ')...');

        await openRowEditor(goal.id, standingBox, 'the goal edit form');

        // ---- Standing ----

        const standing = standingBox();
        const before = select2Text(standing);

        await chooseSelect2(standing, 'Withdrawn', 'goal Standing');

        await sleep(PAUSE.afterField);

        // ---- Completion Period ----

        const period = type === 'new' ? request.newPeriod : request.returningPeriod;

        const periodBox =
            document.getElementById(
                'Goals_' + n + '__StudentAcademicGoal_EndPeriodEndPeriodID_shadow'
            ) ||
            fieldByName('Goals[' + n + '].StudentAcademicGoal.EndPeriod.EndPeriodID_shadow');

        if (!periodBox) {
            throw new Error('The goal Completion Period box is missing.');
        }

        await fillCombobox(periodBox, period, 'Completion Period');

        await sleep(PAUSE.afterField);

        // ---- Completion Date ----

        let date = request.returningDate;

        if (type === 'new') {

            const start = fieldByName('Goals[' + n + '].StudentAcademicGoal.StartDate');

            date = addOneDay(start ? start.value : '');

            if (!date) {
                throw new Error(
                    'The goal Start Date could not be read ("' +
                    (start ? start.value : 'missing') + '"), so the Completion ' +
                    'Date cannot be worked out.'
                );
            }
        }

        await setDateField(
            fieldByName('Goals[' + n + '].StudentAcademicGoal.CompletionDate'),
            date,
            'goal Completion Date'
        );

        await pressDialogOk('the goal dialog');

        applied(
            'Goal: Standing "' + before + '" → Withdrawn, Completion Period ' +
            period + ', Completion Date ' + date
        );
    }


    // =========================================================
    // STEP 2 - CORE ENROLMENT STATUS
    // =========================================================

    function findCoreEditButton() {

        const buttons = [
            ...document.querySelectorAll('button')
        ].filter(
            button => isVisible(button) && button.querySelector('.editIcon')
        );

        return (
            buttons.find(
                button => /#StudentMatriculation['"]/.test(
                    button.getAttribute('onclick') || ''
                )
            ) ||
            null
        );
    }


    async function updateCore(type) {

        const wanted = type === 'new' ? 'No Show' : 'Withdrawn';

        const statusBox = () => select2ByLabel(topDialog(), /^enrol{1,2}ment status/);

        const edit = await waitFor(
            findCoreEditButton,
            WAIT.editForm,
            'the Core Edit button'
        );

        await clickUntil({
            getElement: () => findCoreEditButton() || edit,
            verify: statusBox,
            description: 'the Core edit form',
            verifyTimeout: WAIT.editForm
        });

        await sleep(PAUSE.afterEditOpen);

        const box = statusBox();
        const before = select2Text(box);

        await chooseSelect2(box, wanted, 'Enrolment Status');

        await pressDialogOk('the Core dialog');

        applied('Core: Enrolment Status "' + before + '" → ' + wanted);
    }


    // =========================================================
    // STEP 3 - NOTE TO FINANCE
    // =========================================================

    async function addPreEnrolmentNote(request) {

        const text = newStudentNote(request);

        const rowId = (
            [...document.querySelectorAll('tr[id^="AcaSARPreEnrInfoForFinance_"]')]
                .find(row => /^AcaSARPreEnrInfoForFinance_\d+$/.test(row.id)) ||
            { id: 'AcaSARPreEnrInfoForFinance_0' }
        ).id;

        setStatus('Opening Pre-Enrolment Information for Finance...');

        await openRowEditor(
            rowId,
            () => notesBox('Pre-Enrolment Notes'),
            'the Pre-Enrolment Information for Finance form'
        );

        const outcome = await addNote(
            notesBox('Pre-Enrolment Notes'),
            text,
            'Pre-Enrolment Notes'
        );

        await pressDialogOk('the Pre-Enrolment dialog');

        return 'Pre-Enrolment Notes: "' + text + '" ' + outcome;
    }


    function childRows(parent) {

        const reveal = document.getElementById(parent.id + '_revealRowPeriod');

        if (!reveal) {
            return [];
        }

        return [
            ...reveal.querySelectorAll('tr[id^="Enrollment_"]')
        ].filter(
            row => /^Enrollment_\d+$/.test(row.id) && editIconFor(row.id)
        );
    }


    async function addInYearNote(request) {

        const text = returningStudentNote(request);

        const parents = parentEnrolmentRows() || [];

        const wanted = normalise(request.previousYear);

        let parent = parents.find(
            row => {

                const cell = row.querySelector(':scope > td[data-col-id="_Periods"]');

                return cell && normalise(cell.textContent).includes(wanted);
            }
        );

        if (!parent) {

            parent = parents[0];

            if (!parent) {
                throw new Error('No enrolment row to put the note on.');
            }

            recordEntry(
                'notes',
                '⚠ No ' + request.previousYear + ' row - used the top row ("' +
                cleanText(parent.querySelector('td').textContent) + '")'
            );
        }

        // Expand the parent row so the child row shows.
        if (!childRows(parent).some(isVisible)) {

            const toggle = parent.querySelector(
                'td[data-col-id="_Periods"] .rowReveal'
            );

            if (toggle) {

                try {

                    await clickUntil({
                        getElement: () => toggle,
                        verify: () => childRows(parent).find(isVisible) || null,
                        description: 'the ' + request.previousYear + ' row to expand',
                        verifyTimeout: WAIT.editForm
                    });

                } catch (error) {}
            }
        }

        await sleep(PAUSE.afterExpand);

        const child = childRows(parent).find(isVisible);

        // The procedure says the child row. If its form has no
        // In Year Notes to Finance box, the parent row's is used.
        const targets = (child ? [child] : []).concat(parent);

        for (const row of targets) {

            checkStopped();

            const which = row === parent ? 'parent' : 'child';

            setStatus('Opening the ' + which + ' enrolment row (' + row.id + ')...');

            await openRowEditor(
                row.id,
                () => topDialog(),
                'the ' + which + ' enrolment edit form'
            );

            let box = null;

            try {

                box = await waitFor(
                    () => notesBox('In Year Notes to Finance'),
                    6000,
                    'the In Year Notes to Finance box'
                );

            } catch (error) {}

            if (!box) {

                // Close without changing anything, try the next.
                pressEscape();
                await sleep(PAUSE.afterOk);

                if (topDialog()) {
                    await pressDialogOk('the empty enrolment dialog');
                }

                continue;
            }

            const outcome = await addNote(box, text, 'In Year Notes to Finance');

            await pressDialogOk('the enrolment dialog');

            return 'In Year Notes to Finance (' + which + ' row ' + row.id +
                '): "' + text + '" ' + outcome;
        }

        throw new Error('No In Year Notes to Finance box on the ' +
            request.previousYear + ' enrolment rows.');
    }


    // =========================================================
    // ONE STUDENT
    // =========================================================

    async function processStudent(studentId, request) {

        dialogsCleared = 0;
        currentStudentId = studentId;

        recordFact({ studentId, started: true });

        setStatus('Processing student ' + studentId);

        await searchStudent(studentId);

        await openStudentRecord(studentId);

        // Holds are ignored on purpose.

        const type = getFact('type') || await readStudentType();

        recordFact({ type });

        const outcome = type === 'new' ? 'No Show' : 'Withdrawn';

        setStatus(
            studentId + ' is a ' + (type === 'new' ? 'NEW' : 'RETURNING') +
            ' student → ' + outcome
        );

        await sleep(1500);

        if (CONFIG.dryRun) {

            note(
                'DRY RUN: ' + type + ' student - would set the goal to Withdrawn (' +
                (type === 'new' ? request.newPeriod + ', start date + 1 day'
                    : request.returningPeriod + ', ' + request.returningDate) +
                '), Enrolment Status to ' + outcome + ' and add the finance note'
            );

            recordFact({ status: 'DRY RUN - ' + type });

        } else {

            // ---- Goal + Core, then Save ----

            if (!getFact('statusSaved')) {

                await updateGoal(type, request);

                await sleep(PAUSE.afterField);

                await updateCore(type);

                const saved = await saveRecord('the goal and Enrolment Status');

                applied('Saved - ' + saved);

                recordFact({ statusSaved: true });

            } else {

                setStatus('Goal and Enrolment Status were saved before the reload - moving on.');
            }

            // ---- Note to finance, then Save ----

            if (!getFact('noteSaved')) {

                const done = type === 'new'
                    ? await addPreEnrolmentNote(request)
                    : await addInYearNote(request);

                applied(done);

                const saved = await saveRecord('the note to finance');

                applied('Saved - ' + saved);

                recordFact({ noteSaved: true });
            }

            recordFact({ status: outcome + ' (' + type + ' student)' });
        }

        markStage(studentId, 'processed');
        advanceRun(studentId);

        await sleep(DELAY.beforeReturn);

        await returnToSAR();

        return {
            studentId,
            status: getFact('status') || outcome,
            applied: [],
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

        if (document.getElementById('tsmn-batch-panel')) {
            return;
        }

        const saved = loadSettings();
        const form = saved.form || {};

        const value = (name) => {

            if (name === 'noteDate' && form.savedOn !== todayStamp()) {
                return DEFAULTS.noteDate;
            }

            return (typeof form[name] === 'string' && form[name])
                ? form[name]
                : DEFAULTS[name];
        };

        const panel = document.createElement('div');

        panel.id = 'tsmn-batch-panel';

        panel.innerHTML = `
            <div class="tsmn-title">
                TSM No Show / Withdraw
                <span class="tsmn-tab">tab ${TAB_ID}</span>
            </div>

            <div id="tsmn-approve"></div>

            <div class="tsmn-note">
                For students who have not completed the enrolment form.
                No enrolment rows = NEW student → No Show. Enrolment
                rows = RETURNING student → Withdrawn. Holds are ignored.
            </div>

            <label class="tsmn-label" for="tsmn-ids">Student IDs</label>
            <textarea id="tsmn-ids" class="tsmn-box"
                placeholder="One Student ID per line"></textarea>

            <label class="tsmn-label" for="tsmn-notedate">Note date</label>
            <input id="tsmn-notedate" class="tsmn-input" type="text" value="${value('noteDate')}">

            <label class="tsmn-label" for="tsmn-initials">Initials</label>
            <input id="tsmn-initials" class="tsmn-input" type="text" value="${value('initials')}">

            <div class="tsmn-sub">NEW students (No Show)</div>

            <label class="tsmn-label" for="tsmn-newperiod">Goal Completion Period</label>
            <input id="tsmn-newperiod" class="tsmn-input" type="text" value="${value('newPeriod')}">
            <div class="tsmn-hint">Completion Date = the goal Start Date + 1 day</div>

            <div class="tsmn-sub">RETURNING students (Withdrawn)</div>

            <label class="tsmn-label" for="tsmn-retperiod">Goal Completion Period</label>
            <input id="tsmn-retperiod" class="tsmn-input" type="text" value="${value('returningPeriod')}">

            <label class="tsmn-label" for="tsmn-retdate">Goal Completion Date</label>
            <input id="tsmn-retdate" class="tsmn-input" type="text" value="${value('returningDate')}">

            <label class="tsmn-label" for="tsmn-prevyear">Enrolment row for the finance note</label>
            <input id="tsmn-prevyear" class="tsmn-input" type="text" value="${value('previousYear')}">

            <label class="tsmn-check">
                <input type="checkbox" id="tsmn-dry-run">
                Dry run - report only, change nothing
            </label>

            <div id="tsmn-preview" class="tsmn-hint"></div>

            <button id="tsmn-start-batch">START</button>
            <button id="tsmn-stop">STOP</button>
            <button id="tsmn-hide">HIDE PANEL</button>

            <div id="tsmn-status">Ready</div>
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

        Object.assign(panel.querySelector('.tsmn-title').style, {
            fontWeight: 'bold',
            fontSize: '18px',
            marginBottom: '14px'
        });

        Object.assign(panel.querySelector('.tsmn-tab').style, {
            float: 'right',
            padding: '2px 8px',
            background: '#333',
            border: '1px solid #666',
            borderRadius: '10px',
            fontSize: '11px',
            fontWeight: 'normal'
        });

        Object.assign(panel.querySelector('.tsmn-note').style, {
            margin: '0 0 12px 0',
            padding: '8px',
            background: '#242424',
            borderLeft: '3px solid #777',
            borderRadius: '3px',
            fontSize: '12px',
            lineHeight: '1.5'
        });

        panel.querySelectorAll('.tsmn-label').forEach(label => {
            Object.assign(label.style, {
                display: 'block',
                marginTop: '10px',
                marginBottom: '5px',
                fontWeight: 'bold',
                fontSize: '12px'
            });
        });

        panel.querySelectorAll('.tsmn-sub').forEach(item => {
            Object.assign(item.style, {
                marginTop: '16px',
                paddingTop: '8px',
                borderTop: '1px solid #444',
                fontWeight: 'bold',
                fontSize: '13px',
                color: '#9fc5e8'
            });
        });

        panel.querySelectorAll('.tsmn-hint').forEach(item => {
            Object.assign(item.style, {
                marginTop: '4px',
                fontSize: '11px',
                color: '#bbb',
                whiteSpace: 'pre-line',
                lineHeight: '1.4'
            });
        });

        panel.querySelectorAll('.tsmn-check').forEach(label => {
            Object.assign(label.style, {
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                margin: '12px 0 6px 0',
                fontSize: '13px',
                cursor: 'pointer'
            });
        });

        panel.querySelectorAll('.tsmn-box, .tsmn-input').forEach(box => {
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

        Object.assign(document.getElementById('tsmn-ids').style, {
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

        Object.assign(document.getElementById('tsmn-approve').style, {
            display: 'none',
            marginTop: '12px',
            padding: '10px',
            background: '#20303f',
            border: '1px solid #4a7ea1',
            borderRadius: '5px'
        });

        Object.assign(document.getElementById('tsmn-status').style, {
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

        const idsBox = document.getElementById('tsmn-ids');

        const inputs = {
            noteDate: document.getElementById('tsmn-notedate'),
            initials: document.getElementById('tsmn-initials'),
            newPeriod: document.getElementById('tsmn-newperiod'),
            returningPeriod: document.getElementById('tsmn-retperiod'),
            returningDate: document.getElementById('tsmn-retdate'),
            previousYear: document.getElementById('tsmn-prevyear')
        };

        if (typeof saved.ids === 'string') {
            idsBox.value = saved.ids;
        } else if (saved.run && Array.isArray(saved.run.studentIds)) {
            idsBox.value = saved.run.studentIds.join('\n');
        }

        const readForm = () => {

            const request = {};

            for (const [name, input] of Object.entries(inputs)) {
                request[name] = input.value.trim();
            }

            return request;
        };

        const preview = document.getElementById('tsmn-preview');

        const showPreview = () => {

            const request = readForm();

            preview.textContent =
                'New student note:\n' + newStudentNote(request) +
                '\n\nReturning student note:\n' + returningStudentNote(request);
        };

        const saveForm = () => {

            const request = readForm();

            // The note date is today's unless typed in, so it is
            // not carried over to another day.
            request.savedOn = todayStamp();

            saveSetting('form', request);

            showPreview();
        };

        idsBox.addEventListener('input', () => {
            saveSetting('ids', idsBox.value);
        });

        Object.values(inputs).forEach(
            input => input.addEventListener('input', saveForm)
        );

        showPreview();

        const dryRun = document.getElementById('tsmn-dry-run');

        dryRun.checked =
            typeof saved.dryRun === 'boolean' ? saved.dryRun : CONFIG.dryRun;

        CONFIG.dryRun = dryRun.checked;

        dryRun.addEventListener('change', () => {
            CONFIG.dryRun = dryRun.checked;
            saveSetting('dryRun', dryRun.checked);
        });

        // ---- Start ----

        const startButton = document.getElementById('tsmn-start-batch');

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

            const request = readForm();

            const dateOk = text => /^\d{2}\/\d{2}\/\d{4}$/.test(text);

            if (
                !request.noteDate || !request.initials ||
                !request.newPeriod || !request.returningPeriod ||
                !dateOk(request.returningDate) || !request.previousYear
            ) {

                setStatus(
                    '⚠ Fill in every box. The returning Completion Date ' +
                    'must be DD/MM/YYYY.',
                    true
                );
                return;
            }

            const confirmation = window.confirm(
                'START?\n\n' + studentIds.length + ' student(s).\n\n' +
                'Holds are ignored.\n\n' +
                'NEW (no enrolment rows) → No Show:\n' +
                '  Goal Standing Withdrawn, ' + request.newPeriod +
                ', start date + 1 day\n' +
                '  Core Enrolment Status No Show, Save\n' +
                '  Pre-Enrolment Notes: "' + newStudentNote(request) + '", Save\n\n' +
                'RETURNING → Withdrawn:\n' +
                '  Goal Standing Withdrawn, ' + request.returningPeriod +
                ', ' + request.returningDate + '\n' +
                '  Core Enrolment Status Withdrawn, Save\n' +
                '  ' + request.previousYear + ' child row In Year Notes to Finance:\n' +
                '  "' + returningStudentNote(request) + '", Save\n\n' +
                (CONFIG.dryRun ? 'DRY RUN - nothing is changed.\n\n' : '') +
                'Continue?'
            );

            if (!confirmation) {
                return;
            }

            startButton.disabled = true;

            saveSetting('lastReport', null);
            saveSetting('ids', idsBox.value);
            saveForm();

            saveRun({ facts: {}, results: [], current: null });

            await processBatch(studentIds, request);
        });

        // ---- Hide ----

        const hideButton = document.getElementById('tsmn-hide');

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

                const box = document.getElementById('tsmn-batch-panel');

                setPanelHidden(!box || box.style.display !== 'none');
            }
        });

        // ---- Stop ----

        document.getElementById('tsmn-stop').addEventListener('click', () => {

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

        const startButton = document.getElementById('tsmn-start-batch');

        if (startButton) {
            startButton.disabled = true;
        }

        const request = run.request;

        if (!request || !request.returningPeriod) {

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

        console.log('TSM No Show / Withdraw Assistant v1.0 loaded.');

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
