// ==UserScript==
// @name         TSM Disability Check Assistant (4 column)
// @namespace    Jaden-TSM
// @version      2.0
// @description  Batch TSM assistant - four column sheet (ID, first name, last name, disability Yes/No): checks Person Accessibility Needs and sets or removes "No known disability"
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




    // =========================================================
    // THE PASTED ROW
    //
    // One line per student, straight out of the spreadsheet,
    // four columns - everything after the fourth is ignored:
    //
    //   student ID, first name, last name, disability Yes/No
    // =========================================================

    function cleanField(value) {

        return String(value || '')
            .replace(/^\s*"+|"+\s*$/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }


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


    function parseRecord(line) {

        let f = splitFields(line);

        // No tabs and no double spaces: try single spaces,
        // with the ID first and the Yes/No last of the four.
        if (f.length < 4 && !line.includes('\t')) {

            const words = String(line).trim().split(/\s+/).map(cleanField);

            if (words.length >= 4) {

                const yn = words.findIndex(
                    (word, index) => index >= 3 && /^(y(es)?|n(o)?)$/i.test(word)
                );

                if (yn > 0) {

                    f = [
                        words[0],
                        words[1],
                        words.slice(2, yn).join(' '),
                        words[yn]
                    ];
                }
            }
        }

        const isYesNo = value => /^(y(es)?|n(o)?)$/i.test(String(value).trim());

        const record = {
            fieldCount: f.length,
            tabbed: line.includes('\t'),
            raw: f,
            problems: [],
            studentId: f[0] || '',
            firstName: f[1] || '',
            lastName: f[2] || '',
            disability: '',
            hasDisability: false
        };

        let value = f[3] || '';

        if (!isYesNo(value)) {

            // A blank name cell shifts the columns - look for the
            // Yes/No in the next couple of cells before giving up.
            const nearby = f.slice(1, 6).find(isYesNo);

            if (nearby) {

                record.problems.push(
                    'Disability is not in the fourth column - used "' +
                    nearby + '".'
                );

                value = nearby;
            }
        }

        record.disability = value;
        record.hasDisability = /^y(es)?$/i.test(String(value).trim());

        if (!value) {

            record.problems.push('No disability value (Yes/No) found.');

        } else if (!isYesNo(value)) {

            record.problems.push(
                'Disability column reads "' + value + '", not Yes or No.'
            );
        }

        return record;
    }


    function cleanField(value) {

        return String(value || '')
            .replace(/^\s*"+|"+\s*$/g, '')
            .replace(/\s+/g, ' ')
            .trim();
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


    function askChoice(title, detail, buttons) {

        return new Promise(resolve => {

            const box = document.getElementById('tsme-approve');

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
                document.getElementById('tsme-start-batch');

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
    const STORAGE_KEY = 'tsme-disability-assistant';


    // The tab's identity. sessionStorage is per tab, and
    // window.name carries it as well so that clearing
    // sessionStorage mid-run cannot orphan the settings.
    const TAB_ID = (function () {

        const fresh = () => Math.random().toString(36).slice(2, 6);

        let id = '';

        try {
            id = window.sessionStorage.getItem('tsme-disability-tab-id') || '';
        } catch (error) {}

        if (!id) {

            try {

                const named = String(window.name || '');

                if (named.startsWith('tsme-disability-tab:')) {
                    id = named.slice('tsme-disability-tab:'.length);
                }

            } catch (error) {}
        }

        if (!id) {
            id = fresh();
        }

        try {
            window.sessionStorage.setItem('tsme-disability-tab-id', id);
        } catch (error) {}

        try {

            const named = String(window.name || '');

            // Never trample a name the site set for itself.
            if (!named || named.startsWith('tsme-disability-tab:')) {
                window.name = 'tsme-disability-tab:' + id;
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
        return document.getElementById('tsme-reopen');
    }


    function ensureReopenButton() {

        if (reopenButton()) {
            return reopenButton();
        }

        const button = document.createElement('button');

        button.id = 'tsme-reopen';
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
            ...document.querySelectorAll('#tsme-batch-panel')
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

        const status = document.getElementById('tsme-status');

        const small = document.getElementById('tsme-reopen');

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
    // DISABILITY CHECK
    // =========================================================

    const PAUSE = {
        afterPerson: 3000,    // Person page settling before reading
        afterEditOpen: 2500,  // after an edit pencil / Edit button
        afterField: 800,
        afterOk: 2000,
        afterDelete: 2500,
        afterSave: 8000       // every Save
    };

    let dialogsCleared = 0;

    const NKD = 'no known disability';


    function getFact(name) {

        try {

            const run = loadSettings().run || {};

            return ((run.facts || {})[currentStudentId] || {})[name];

        } catch (error) {

            return undefined;
        }
    }


    function accessibilityRows() {

        const table = document.getElementById('accessibilityneedTable');

        if (!table) {
            return null;
        }

        return [
            ...table.querySelectorAll('tbody > tr[id^="AccessibilityNeed_"]')
        ].filter(row => /^AccessibilityNeed_\d+$/.test(row.id)).map(row => {

            const cells = row.querySelectorAll(':scope > td');

            return {
                row,
                id: row.id,
                type: normalise(cells[0] ? cells[0].textContent : ''),
                condition: normalise(cells[1] ? cells[1].textContent : '')
            };
        });
    }


    function isNKD(item) {
        return item.condition.includes(NKD);
    }


    function readDisabilitiesText() {

        const hidden = document.querySelector('#Disabilities');

        if (hidden && cleanField(hidden.value)) {
            return cleanField(hidden.value);
        }

        const label = document.querySelector('label[for="Disabilities"]');

        if (!label) {
            return '';
        }

        const field = label.closest('.field') || label.parentElement;
        const span = field && field.querySelector('span');

        return span ? cleanField(span.textContent) : '';
    }


    async function savePerson(description) {

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

            setStatus('Save pressed but the record still looks unsaved - pressing again...');

            await realMouseClick(still);

            await sleep(PAUSE.afterSave);

            if (isDirty()) {
                return 'Save pressed - record still looks unsaved';
            }
        }

        return 'Saved';
    }


    // Adds "No known disability" to the Disabilities selector
    // on the Person edit form.
    async function setNoKnownDisability() {

        const edit = await waitFor(
            findPersonEditButton,
            WAIT.editForm,
            'the Person Edit button'
        );

        await clickUntil({
            getElement: () => findPersonEditButton() || edit,
            verify: () => findDisabilitySearchInput(),
            description: 'the Person edit form',
            verifyTimeout: WAIT.editForm
        });

        await sleep(PAUSE.afterEditOpen);

        const input = await waitFor(
            findDisabilitySearchInput,
            WAIT.editForm,
            'the Disabilities selector'
        );

        await realMouseClick(input);
        await typeInto(input, 'no known disability');

        await sleep(1000);

        input.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'ArrowDown', code: 'ArrowDown',
            keyCode: 40, which: 40, bubbles: true
        }));

        await sleep(300);

        pressEnter(input);

        await sleep(PAUSE.afterField);

        const chosen = [
            ...document.querySelectorAll('#s2id_DisabilitiesIDs .select2-search-choice')
        ].map(item => normalise(item.textContent));

        if (!chosen.some(text => text.includes(NKD))) {

            throw new Error(
                'The Disabilities box did not take "No known disability" ' +
                '(it holds: ' + (chosen.join(', ') || 'nothing') + ').'
            );
        }

        await confirmDialogOk();

        await sleep(PAUSE.afterOk);
    }


    // Removes one Accessibility Needs row via its pencil and Delete.
    async function deleteAccessibilityRow(id) {

        const rowNow = () => document.getElementById(id);

        const pencil = () => {

            const row = rowNow();

            return row ? row.querySelector('span.icon.editIcon') : null;
        };

        const removeButton = () => [
            ...document.querySelectorAll('button.removeButton')
        ].find(button => isVisible(button) && !button.disabled) || null;

        await clickUntil({
            getElement: pencil,
            verify: removeButton,
            description: 'the edit form for ' + id,
            verifyTimeout: WAIT.editForm
        });

        await sleep(PAUSE.afterEditOpen);

        await realMouseClick(removeButton());

        await sleep(PAUSE.afterDelete);

        // Delete is followed by an OK to confirm it, and
        // sometimes by a second one. Keep pressing OK until
        // none turns up.
        let pressed = 0;

        for (let round = 0; round < 4; round++) {

            checkStopped();

            const ok = await waitFor(
                findOkButton,
                round === 0 ? 8000 : 4000,
                'a confirmation OK button'
            ).catch(() => null);

            if (!ok) {
                break;
            }

            setStatus('Confirming the deletion (OK ' + (pressed + 1) + ')...');

            await realMouseClick(ok);

            pressed++;

            await sleep(PAUSE.afterDelete);
        }

        if (!pressed) {

            // Some versions ask with a Yes / Confirm button instead.
            const confirm = [
                ...document.querySelectorAll(
                    '.ui-dialog button, .ui-dialog-buttonset button'
                )
            ].find(
                button =>
                    isVisible(button) &&
                    /^(yes|confirm|delete)$/.test(normalise(button.textContent))
            );

            if (confirm) {

                await realMouseClick(confirm);

                await sleep(PAUSE.afterDelete);
            }
        }

        await waitFor(
            () => (!rowNow() || !isVisible(rowNow()) ||
                   rowNow().classList.contains('deleted') ||
                   rowNow().classList.contains('removed')) ? true : null,
            WAIT.editForm,
            'the row ' + id + ' to disappear'
        );
    }


    // =========================================================
    // ONE STUDENT
    // =========================================================

    async function finish(studentId, status, applied, notes) {

        recordFact({ status });

        markStage(studentId, 'processed');
        advanceRun(studentId);

        setStatus(
            studentId + ' — ' + status + '\n' +
            applied.concat(notes).join('\n')
        );

        await sleep(DELAY.beforeReturn);

        await returnToSAR();

        return {
            studentId,
            status,
            applied,
            skipped: [],
            notes
        };
    }


    async function processStudent(studentId, request) {

        const record = request.records[studentId];

        if (!record) {
            throw new Error('No data row for ' + studentId + '.');
        }

        dialogsCleared = 0;
        currentStudentId = studentId;

        recordFact({ studentId, started: true });

        setStatus('Processing student ' + studentId);

        const sheet = String(record.disability || '').trim();
        const sheetNo = /^n(o)?$/i.test(sheet);
        const sheetYes = /^y(es)?$/i.test(sheet);

        await searchStudent(studentId);

        await openStudentRecord(studentId);

        await openPerson();

        await waitFor(
            () => accessibilityRows(),
            WAIT.personPage,
            'the Accessibility Needs table'
        );

        await sleep(PAUSE.afterPerson);

        const applied = [];
        const notes = [];

        let rows = accessibilityRows() || [];

        const describe = list => list.length
            ? list.map(item => item.type + ': ' + item.condition).join('; ')
            : '(no rows)';

        notes.push('Sheet disability: ' + (sheet || '(blank)'));
        notes.push('Accessibility Needs: ' + describe(rows));

        const nkdRows = rows.filter(isNKD);
        const otherRows = rows.filter(item => !isNKD(item));

        // ---- A real condition alongside a "No known disability" row ----
        if (otherRows.length && nkdRows.length) {

            if (CONFIG.dryRun) {

                notes.push(
                    'DRY RUN: would delete ' + nkdRows.length +
                    ' "No known disability" row(s).'
                );

            } else {

                recordFact({ changed: true });

                for (const item of nkdRows) {

                    checkStopped();

                    setStatus('Deleting the "No known disability" row (' + item.id + ')...');

                    await deleteAccessibilityRow(item.id);

                    applied.push(
                        'Deleted "No known disability" row (' + item.type +
                        ') because a condition is also recorded'
                    );

                    recordEntry('applied', applied[applied.length - 1]);
                }

                const saved = await savePerson('the Person record');

                applied.push('Saved - ' + saved);
                recordEntry('applied', 'Saved - ' + saved);
            }

            if (sheetNo) {

                notes.push(
                    '⚠ Sheet says No but the record holds: ' +
                    describe(otherRows) + ' - check this student.'
                );
            }

            return await finish(
                studentId,
                CONFIG.dryRun ? 'DRY RUN' : 'Updated',
                applied,
                notes
            );
        }

        // ---- Sheet says No ----
        if (sheetNo) {

            if (nkdRows.length && !otherRows.length) {

                if (/no known disability/i.test(readDisabilitiesText())) {

                    notes.push('Disabilities already reads "No known disability".');

                    return await finish(
                        studentId,
                        getFact('changed') ? 'Updated' : 'No change needed',
                        applied,
                        notes
                    );
                }

                if (CONFIG.dryRun) {

                    notes.push('DRY RUN: would set Disabilities to "No known disability".');

                    return await finish(studentId, 'DRY RUN', applied, notes);
                }

                recordFact({ changed: true });

                await setNoKnownDisability();

                applied.push('Disabilities set to "No known disability"');
                recordEntry('applied', applied[applied.length - 1]);

                const saved = await savePerson('the Person record');

                applied.push('Saved - ' + saved);
                recordEntry('applied', 'Saved - ' + saved);

                return await finish(studentId, 'Updated', applied, notes);
            }

            // Sheet No, but no "No known disability" box.
            const why = rows.length
                ? 'Sheet says No but the record does not say "No known disability" (' +
                  describe(rows) + ').'
                : 'Sheet says No but there are no Accessibility Needs rows.';

            recordEntry('notes', '⚠ ' + why);

            return await finish(
                studentId,
                'SKIPPED - sheet No, record differs',
                applied,
                notes.concat(['⚠ ' + why])
            );
        }

        // ---- Sheet says Yes or is blank: nothing to do here ----
        const why = sheetYes
            ? 'Sheet says Yes - this assistant only handles "No" rows.'
            : 'Sheet disability value is "' + (sheet || 'blank') + '" - not handled.';

        recordEntry('notes', '⚠ ' + why);

        return await finish(
            studentId,
            'SKIPPED - sheet not No',
            applied,
            notes.concat(['⚠ ' + why])
        );
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



    function createPanel() {

        if (document.getElementById('tsme-batch-panel')) {
            return;
        }

        const panel = document.createElement('div');

        panel.id = 'tsme-batch-panel';

        panel.innerHTML = `

            <div class="tsme-title">
                TSM Disability Check
                <span class="tsme-tab">tab ${TAB_ID}</span>
            </div>

            <div id="tsme-approve"></div>

            <div class="tsme-note">Four columns per student, pasted straight from the spreadsheet: Student ID, First name, Last name, Disability (Yes/No). Anything after the fourth column is ignored. Only students whose sheet says No are changed.</div>

            <label class="tsme-label" for="tsme-records">
                Spreadsheet rows
            </label>

            <textarea
                id="tsme-records"
                class="tsme-box tsme-tall"
                placeholder="ID &#9; first name &#9; last name &#9; disability (Yes/No)"
            ></textarea>

            <label class="tsme-check">
                <input type="checkbox" id="tsme-dry-run">
                Dry run - report only, approve nothing
            </label>

            <button id="tsme-start-batch">
                START
            </button>

            <button id="tsme-stop">
                STOP
            </button>

            <button id="tsme-hide">
                HIDE PANEL
            </button>

            <div id="tsme-status">
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
            panel.querySelector('.tsme-title').style,
            {
                fontWeight: 'bold',
                fontSize: '18px',
                marginBottom: '14px'
            }
        );

        const tabLabel = panel.querySelector('.tsme-tab');

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

        panel.querySelectorAll('.tsme-note').forEach(
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

        panel.querySelectorAll('.tsme-label').forEach(
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

        const recordInput = document.getElementById('tsme-records');

        panel.querySelectorAll('.tsme-box').forEach(
            box => {

                Object.assign(
                    box.style,
                    {
                        width: '100%',
                        boxSizing: 'border-box',
                        minHeight: box.classList.contains('tsme-tall')
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

        panel.querySelectorAll('.tsme-check').forEach(
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

        const approve = document.getElementById('tsme-approve');

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

        const status = document.getElementById('tsme-status');

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

        const dryRun = document.getElementById('tsme-dry-run');

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
            document.getElementById('tsme-start-batch');

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
                const preview = studentIds.slice(0, 5).map(
                    id => {

                        const r = records[id];

                        return (
                            id + '  ' + r.firstName + ' ' + r.lastName +
                            '  -  disability: ' + (r.disability || '(none)')
                        );
                    }
                ).join('\n');

                const confirmation = window.confirm(
                    'START?\n\n' +
                    studentIds.length + ' student(s):\n\n' +
                    studentIds.join(', ') +
                    '\n\nRead from the first row(s):\n\n' + preview +
                    '\n\nFor each student:\n\n' +
                    '1. Open the Person record\n' +
                    '2. Sheet No + "No known disability" row: set\n' +
                    '   Disabilities to "No known disability", save\n' +
                    '3. Condition + "No known disability" rows:\n' +
                    '   delete the "No known disability" row, save\n' +
                    '4. Anything else: skip and report\n' +
                    '5. Return to SAR\n\n' +
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

        const hideButton = document.getElementById('tsme-hide');

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
                        document.getElementById('tsme-batch-panel');

                    setPanelHidden(
                        !panel || panel.style.display !== 'none'
                    );
                }
            }
        );

        // ---- Stop ----

        const stopButton = document.getElementById('tsme-stop');

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
            document.getElementById('tsme-start-batch');

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
            'TSM Disability Check Assistant (4 column) v2.0 loaded.'
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
