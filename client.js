$(document).ready(function() {
    const LOCK_PREFIX = '[admin-chat-lock]';
    const LOCKED_MESSAGE_TEXT = '🔒 חדר זה ננעל ע"י המנהלים.';

    function isEnglishSystem() {
        return $('html').attr('lang') && $('html').attr('lang').startsWith('en');
    }

    function replaceAdminEmptyStateText() {
        if (!app.user.isAdmin) return;

        $('span.text-muted.text-sm').each(function() {
            const currentText = $(this).text().trim();

            if (currentText.includes("אין לכם צ'אטים פעילים") || currentText === "אין לכם צ'אטים פעילים.") {
                $(this).text("אנא בחר צ'אט מסרגל הצד.");
                $(this).removeClass('text-muted');
            }

            if (currentText.includes('You have no active chats') || currentText === 'You have no active chats.') {
                $(this).text('Please select a chat from the sidebar.');
                $(this).removeClass('text-muted');
            }
        });
    }

    function getRoomData() {
        if (!ajaxify || !ajaxify.data) {
            return null;
        }

        return ajaxify.data.room || ajaxify.data;
    }

    function getLockText() {
        if (isEnglishSystem()) {
            return '🔒 This room was locked by the administrators.';
        }

        return LOCKED_MESSAGE_TEXT;
    }

    function renderLockBanner() {
        const roomData = getRoomData();
        const lockData = roomData && roomData.adminChatLock;
        $('.admin-chat-lock-banner').remove();

        if (!lockData || !lockData.isLocked) {
            return;
        }

        const target = $('[component="chat/messages"]').first().parent();
        if (!target.length) {
            return;
        }

        target.prepend(`
            <div class="admin-chat-lock-banner alert alert-warning mb-2">${getLockText()}</div>
        `);
    }

    function setComposerVisibility(shouldHide) {
        const selectors = [
            '[component="chat/composer"]',
            '[component="chat/replies"]',
            '[component="chat/input"]',
            '[component="chat/textarea"]',
            '.chat-input',
            '.composer',
        ];

        const seen = new Set();
        selectors.forEach(function(selector) {
            $(selector).each(function() {
                const $element = $(this);
                const $container = $element.closest('[component="chat/composer"], [component="chat/replies"], .chat-input, .composer').length ?
                    $element.closest('[component="chat/composer"], [component="chat/replies"], .chat-input, .composer').first() :
                    $element;
                const domNode = $container.get(0);

                if (!domNode || seen.has(domNode)) {
                    return;
                }

                seen.add(domNode);
                $container.toggle(!shouldHide);
            });
        });
    }

    function updateComposerState() {
        const roomData = getRoomData();
        const lockData = roomData && roomData.adminChatLock;
        const shouldHideComposer = !!(lockData && lockData.isLocked && !(app.user && app.user.isAdmin));

        $('[component="chat/input"], [component="chat/textarea"], textarea.chat-input, .chat-input textarea')
            .prop('disabled', shouldHideComposer)
            .attr('placeholder', shouldHideComposer ? getLockText() : null);

        $('[component="chat/send"], .chat-send, button[component="chat/submit"]').prop('disabled', shouldHideComposer);

        setComposerVisibility(shouldHideComposer);
        renderLockBanner();
    }

    function normalizeLockMessages() {
        $('[component="chat/message/content"], .chat-message-content').each(function() {
            const $el = $(this);
            const text = $el.text().trim();
            if (!text.startsWith(LOCK_PREFIX)) {
                return;
            }

            $el.text(text.replace(LOCK_PREFIX, '').trim());
        });
    }

    function getRoomMenuTargets() {
        return $('[component="chat/header"], .chat-header, [component="chat/nav"]')
            .find('.dropdown-menu');
    }

    function renderAdminLockControl() {
        $('.admin-chat-lock-toggle-item, .admin-chat-lock-divider').remove();

        if (!app.user.isAdmin) {
            return;
        }

        const roomData = getRoomData();
        const roomId = roomData && roomData.roomId;
        if (!roomId) {
            return;
        }

        const menus = getRoomMenuTargets();
        if (!menus.length) {
            return;
        }

        const lockData = roomData.adminChatLock || {};
        const isLocked = !!lockData.isLocked;
        const itemText = isEnglishSystem() ? (isLocked ? 'Unlock Room' : 'Lock Room') : (isLocked ? 'פתח חדר' : 'נעל חדר');
        const iconClass = isLocked ? 'fa-lock-open' : 'fa-lock';
        const menuItemHtml = `
            <li role="presentation" class="admin-chat-lock-item-wrap">
                <a href="#" role="menuitem" class="dropdown-item rounded-1 d-flex align-items-center gap-2 admin-chat-lock-toggle-item" data-room-id="${roomId}" data-locked="${isLocked}">
                    <i class="fa fa-fw ${iconClass}"></i>
                    <span>${itemText}</span>
                </a>
            </li>
            <li role="presentation" class="dropdown-divider admin-chat-lock-divider"></li>
        `;

        menus.each(function() {
            const $menu = $(this);
            if ($menu.find('.admin-chat-lock-toggle-item').length) {
                return;
            }

            $menu.prepend(menuItemHtml);
        });
    }

    async function toggleRoomLock(roomId, nextState) {
        const response = await fetch(`${config.relative_path || ''}/api/admin-chats/${roomId}/lock`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-csrf-token': config.csrf_token,
            },
            body: JSON.stringify({ locked: nextState }),
        });

        if (!response.ok) {
            throw new Error('Unable to update room lock');
        }

        return await response.json();
    }

    function refreshChatUi() {
        replaceAdminEmptyStateText();
        renderAdminLockControl();
        updateComposerState();
        normalizeLockMessages();
    }

    $(window).on('action:ajaxify.end', function(ev, data) {
        const templateName = ajaxify && ajaxify.data && ajaxify.data.template ? ajaxify.data.template.name : '';

        if (app.user.isAdmin && templateName.startsWith('account/')) {
            const userSlug = ajaxify.data.userslug || (ajaxify.data.user && ajaxify.data.user.userslug);

            if (userSlug) {
                const buttonText = isEnglishSystem() ? 'View Chats' : "צפיה בצ'אטים";
                const relativePath = config.relative_path || '';

                const btnHtml = `
                    <li role="presentation">
                        <a class="dropdown-item rounded-1 d-flex align-items-center gap-2" href="${relativePath}/user/${userSlug}/chats" role="menuitem">
                            <i class="far fa-fw fa-comments"></i>
                            <span>${buttonText}</span>
                        </a>
                    </li>
                    <li role="presentation" class="dropdown-divider"></li>
                `;
                const menu = $('.account-sub-links');
                if (menu.length) {
                    menu.find(`a[href*="/user/${userSlug}/chats"]`).parent().remove();
                    menu.prepend(btnHtml);
                }
            }
        }

        const url = data && data.url ? data.url : '';

        if (url.match(/^user\/.+\/chats/) || url === 'chats') {
            refreshChatUi();
            setTimeout(refreshChatUi, 500);
        }
    });

    $(window).on('action:chat.loaded', function() {
        refreshChatUi();
        setTimeout(refreshChatUi, 200);
    });

    $(window).on('action:chat.closed', function() {
        setTimeout(refreshChatUi, 200);
    });

    $(document).on('click', '.admin-chat-lock-toggle-item', async function(ev) {
        ev.preventDefault();

        const $button = $(this);
        const roomId = parseInt($button.attr('data-room-id'), 10);
        const isLocked = $button.attr('data-locked') === 'true';

        if (!roomId) {
            return;
        }

        $button.addClass('disabled').attr('aria-disabled', 'true');

        try {
            const result = await toggleRoomLock(roomId, !isLocked);
            if (ajaxify && ajaxify.data) {
                ajaxify.data.adminChatLock = result.lockData;
                if (ajaxify.data.room) {
                    ajaxify.data.room.adminChatLock = result.lockData;
                }
            }
            ajaxify.refresh();
        } catch (err) {
            app.alertError(isEnglishSystem() ? 'Unable to update room lock.' : 'לא ניתן לעדכן את נעילת החדר.');
            $button.removeClass('disabled').removeAttr('aria-disabled');
        }
    });
});
