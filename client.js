$(document).ready(function() {
    const LOCK_PREFIX = '[admin-chat-lock]';
    const TEXT = {
        he: {
            lockBanner: '🔒 חדר זה ננעל ע"י המנהלים.',
            menuLock: 'נעל חדר',
            menuRelease: 'שחרר נעילה',
            updateError: 'לא ניתן לעדכן את נעילת החדר.',
            viewChats: "צפיה בצ'אטים",
            emptyState: "אנא בחר צ'אט מסרגל הצד.",
        },
        en: {
            lockBanner: '🔒 This room was locked by the administrators.',
            menuLock: 'Lock Room',
            menuRelease: 'Release Lock',
            updateError: 'Unable to update room lock.',
            viewChats: 'View Chats',
            emptyState: 'Please select a chat from the sidebar.',
        },
    };

    function isEnglishSystem() {
        return $('html').attr('lang') && $('html').attr('lang').startsWith('en');
    }

    function t(key) {
        const dict = isEnglishSystem() ? TEXT.en : TEXT.he;
        return dict[key];
    }

    function replaceAdminEmptyStateText() {
        if (!app.user.isAdmin) return;

        $('span.text-muted.text-sm').each(function() {
            const currentText = $(this).text().trim();
            if (
                currentText.includes("אין לכם צ'אטים פעילים") ||
                currentText === "אין לכם צ'אטים פעילים." ||
                currentText.includes('You have no active chats') ||
                currentText === 'You have no active chats.'
            ) {
                $(this).text(t('emptyState'));
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

    function isLockedForCurrentUser() {
        const roomData = getRoomData();
        return !!(roomData && roomData.adminChatLock && roomData.adminChatLock.isLocked && !(app.user && app.user.isAdmin));
    }

    function renderLockBanner() {
        $('.admin-chat-lock-banner').remove();

        if (!isLockedForCurrentUser()) {
            return;
        }

        const target = $('[component="chat/messages"]').first().parent();
        if (!target.length) {
            return;
        }

        const positionStyle = isEnglishSystem() ? 'float:right; clear:both;' : 'float:left; clear:both;';
        target.prepend(`<div class="admin-chat-lock-banner alert alert-warning mb-2 text-start" style="${positionStyle} max-width: fit-content;">${t('lockBanner')}</div>`);
    }

    function setComposerHidden(hidden) {
        [
            '[component="chat/composer"]',
            '[component="chat/message/window"] [component="chat/composer"]',
            '[component="chat/main-wrapper"] [component="chat/composer"]',
            '.expanded-chat [component="chat/composer"]',
        ].forEach(function(selector) {
            $(selector).each(function() {
                const $composer = $(this);
                if (hidden) {
                    $composer.addClass('hidden').hide();
                } else {
                    $composer.removeClass('hidden').show();
                }
            });
        });

        $('[component="chat/input"], [component="chat/send"], button[data-action="send"], textarea.chat-input')
            .prop('disabled', hidden)
            .attr('disabled', hidden ? 'disabled' : null);
    }

    function updateComposerVisibility() {
        setComposerHidden(isLockedForCurrentUser());
    }

    function updateLockedActionVisibility() {
        const hidden = isLockedForCurrentUser();

        [
            '[data-action="reply"]',
            '[data-action="edit"]',
            '[data-action="delete"]',
            '[data-action="restore"]',
            '[data-action="kick"]',
            '[data-action="toggleOwner"]'
        ].forEach(function(selector) {
            $(selector).toggleClass('hidden', hidden).toggle(!hidden);
        });

        $('[component="chat/controlsToggle"]').closest('.dropdown').toggleClass('hidden', hidden).toggle(!hidden);
        $('[component="chat/manage/user/add/search"], [component="chat/manage/user/list/search"], [component="chat/manage/save"]')
            .toggleClass('hidden', hidden)
            .toggle(!hidden)
            .prop('disabled', hidden)
            .attr('disabled', hidden ? 'disabled' : null);
        $('[component="chat/manage-modal"] .form-text, [component="chat/manage-modal"] .text-danger')
            .toggleClass('hidden', hidden);
    }

    function normalizeLockMessages() {
        $('[component="chat/system-message"] > div').each(function() {
            const $el = $(this);
            const text = $el.text().trim();
            if (!text.includes('admin-chat-lock')) {
                return;
            }

            $el.text(t('lockBanner'));
        });
    }

    function getRoomMenuTargets() {
        return $('[component="chat/header"], .chat-header, [component="chat/nav"]').find('.dropdown-menu');
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
        const itemText = isLocked ? t('menuRelease') : t('menuLock');
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
        updateComposerVisibility();
        updateLockedActionVisibility();
        renderLockBanner();
        normalizeLockMessages();
    }

    $(window).on('action:ajaxify.end', function(ev, data) {
        const templateName = ajaxify && ajaxify.data && ajaxify.data.template ? ajaxify.data.template.name : '';

        if (app.user.isAdmin && templateName.startsWith('account/')) {
            const userSlug = ajaxify.data.userslug || (ajaxify.data.user && ajaxify.data.user.userslug);

            if (userSlug) {
                const relativePath = config.relative_path || '';
                const btnHtml = `
                    <li role="presentation">
                        <a class="dropdown-item rounded-1 d-flex align-items-center gap-2" href="${relativePath}/user/${userSlug}/chats" role="menuitem">
                            <i class="far fa-fw fa-comments"></i>
                            <span>${t('viewChats')}</span>
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
            setTimeout(refreshChatUi, 1200);
        }
    });

    $(window).on('action:chat.loaded', function() {
        refreshChatUi();
        setTimeout(refreshChatUi, 200);
        setTimeout(refreshChatUi, 1000);
    });

    $(window).on('action:chat.closed', function() {
        setTimeout(refreshChatUi, 200);
    });

    $(window).on('action:chat.onMessagesAddedToDom action:chat.edited', function() {
        setTimeout(updateLockedActionVisibility, 0);
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
                ajaxify.data.canReply = !result.lockData.isLocked || (app.user && app.user.isAdmin);
                ajaxify.data.showUserInput = ajaxify.data.canReply;
                if (ajaxify.data.room) {
                    ajaxify.data.room.adminChatLock = result.lockData;
                    ajaxify.data.room.canReply = ajaxify.data.canReply;
                    ajaxify.data.room.showUserInput = ajaxify.data.showUserInput;
                }
            }
            ajaxify.refresh();
        } catch (err) {
            app.alertError(t('updateError'));
            $button.removeClass('disabled').removeAttr('aria-disabled');
        }
    });
});
