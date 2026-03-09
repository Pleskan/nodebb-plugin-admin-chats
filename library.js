'use strict';

const User = require.main.require('./src/user');
const Messaging = require.main.require('./src/messaging');
const db = require.main.require('./src/database');

const plugin = {};
const LOCK_PREFIX = '[admin-chat-lock]';
const LOCKED_MESSAGE_TEXT = '🔒 חדר זה ננעל ע"י המנהלים.';
const UNLOCKED_MESSAGE_TEXT = '🔓 חדר זה נפתח מחדש ע"י המנהלים.';

plugin.init = async function (params) {
    registerRoutes(params.router, params.middleware);
    overrideMessagingFunctions();
};

plugin.addProfileLink = async function (data) {
    try {
        const userSlug = data.user ? data.user.userslug : (data.userData ? data.userData.userslug : null);

        if (userSlug) {
            data.links.push({
                id: 'admin-view-chats',
                route: 'user/' + userSlug + '/chats',
                icon: 'fa-comments',
                name: 'צפה בצ\'אטים',
                visibility: {
                    self: false,
                    other: true,
                    moderator: false,
                    globalMod: false,
                    admin: true,
                }
            });
        }
    } catch (e) {
        console.error('[Super Admin Chats] Error adding profile link:', e);
    }
    return data;
};

plugin.isRoomOwner = async function (payload) {
    const isAdmin = await User.isAdministrator(payload.uid);
    if (isAdmin) {
        payload.isOwner = true;
    }
    return payload;
};

plugin.isUserInRoom = async function (payload) {
    const isAdmin = await User.isAdministrator(payload.uid);
    if (isAdmin) {
        payload.inRoom = true;
    }
    return payload;
};

plugin.canReply = async function (payload) {
    const uid = getCallerUid(payload);
    const roomId = getRoomId(payload);
    const isAdmin = await User.isAdministrator(uid);

    if (isAdmin) {
        payload.canReply = true;
        return payload;
    }

    if (roomId && await isRoomLocked(roomId)) {
        payload.canReply = false;
    }

    return payload;
};

plugin.canGetMessages = async function (payload) {
    const isAdmin = await User.isAdministrator(payload.callerUid);
    if (isAdmin) {
        payload.canGet = true;
    }
    return payload;
};

plugin.canGetRecentChats = async function (payload) {
    const isAdmin = await User.isAdministrator(payload.callerUid);
    if (isAdmin) {
        payload.canGet = true;
    }
    return payload;
};

plugin.canGetPublicChats = async function (payload) {
    const isAdmin = await User.isAdministrator(payload.callerUid);
    if (isAdmin) {
        payload.canGet = true;
    }
    return payload;
};

plugin.onLoadRoom = async function (payload) {
    const { uid, room } = payload;
    if (!room) {
        return payload;
    }

    const isAdmin = await User.isAdministrator(uid);
    const lockData = await getRoomLockData(room.roomId);
    room.adminChatLock = lockData;

    if (lockData.isLocked) {
        room.messages = appendLockNotice(room.messages, lockData);
    }

    if (!isAdmin) {
        return payload;
    }

    const isOfficialMember = await db.isSortedSetMember(`chat:room:${room.roomId}:uids`, uid);

    if (!isOfficialMember) {
        await db.sortedSetRemove(`chat:room:${room.roomId}:uids:online`, uid);

        if (Array.isArray(room.users)) {
            room.users = room.users.filter(user => user && parseInt(user.uid, 10) !== parseInt(uid, 10));
        }
        if (room.userCount > 0) {
            room.userCount -= 1;
        }
        room.groupChat = room.userCount > 2;

        const allMids = await db.getSortedSetRevRange(`chat:room:${room.roomId}:mids`, 0, 49);

        if (allMids.length > 0) {
            const messages = await Messaging.getMessagesData(allMids, uid, room.roomId, false);
            const messageCount = await db.getObjectField(`chat:room:${room.roomId}`, 'messageCount');
            const count = parseInt(messageCount, 10) || 0;

            messages.forEach((msg, index) => {
                msg.index = count - index - 1;
            });

            room.messages = appendLockNotice(messages.reverse(), lockData);

            room.messages.forEach((msg, index) => {
                if (index === 0) {
                    msg.newSet = true;
                } else {
                    const prevMsg = room.messages[index - 1];
                    msg.newSet = parseInt(msg.fromuid, 10) !== parseInt(prevMsg.fromuid, 10);
                }
            });
        }

        room.isAdmin = true;
        room.isOwner = true;
    } else {
        room.isAdmin = true;
    }
    return payload;
};

function overrideMessagingFunctions() {
    const originalCanEdit = Messaging.canEdit;
    const originalCanDelete = Messaging.canDelete;
    const originalCanViewMessage = Messaging.canViewMessage;
    const originalCanReply = Messaging.canReply;

    Messaging.canEdit = async function (messageId, uid) {
        if (await User.isAdministrator(uid)) {
            return true;
        }
        return await originalCanEdit(messageId, uid);
    };

    Messaging.canDelete = async function (messageId, uid) {
        if (await User.isAdministrator(uid)) {
            return true;
        }
        return await originalCanDelete(messageId, uid);
    };

    Messaging.canViewMessage = async function (mids, roomId, uid) {
        if (await User.isAdministrator(uid)) {
            return Array.isArray(mids) ? mids.map(() => true) : true;
        }
        return await originalCanViewMessage(mids, roomId, uid);
    };

    if (typeof originalCanReply === 'function') {
        Messaging.canReply = async function (...args) {
            const guessed = guessRoomIdUidFromArgs(args);
            if (await User.isAdministrator(guessed.uid)) {
                return true;
            }
            if (guessed.roomId && await isRoomLocked(guessed.roomId)) {
                return false;
            }
            return await originalCanReply.apply(this, args);
        };
    }
};

function registerRoutes(router, middleware) {
    if (!router) {
        return;
    }

    const routeMiddleware = [];
    if (middleware && typeof middleware.ensureLoggedIn === 'function') {
        routeMiddleware.push(middleware.ensureLoggedIn);
    }

    router.post('/api/admin-chats/:roomId/lock', ...routeMiddleware, async (req, res) => {
        try {
            const actingUid = req.uid;
            const roomId = parseInt(req.params.roomId, 10);

            if (!actingUid || Number.isNaN(roomId)) {
                return res.status(400).json({ status: { code: 'bad-request', message: 'Invalid room id' } });
            }

            if (!await User.isAdministrator(actingUid)) {
                return res.status(403).json({ status: { code: 'forbidden', message: 'Admin only' } });
            }

            if (!await roomExists(roomId)) {
                return res.status(404).json({ status: { code: 'not-found', message: 'Room not found' } });
            }

            const shouldLock = req.body && typeof req.body.locked === 'boolean' ? req.body.locked : true;
            const lockData = shouldLock ?
                await lockRoom(roomId, actingUid) :
                await unlockRoom(roomId, actingUid);

            return res.json({
                status: { code: 'ok', message: 'Room updated' },
                roomId,
                lockData,
            });
        } catch (err) {
            console.error('[Super Admin Chats] Error updating room lock:', err);
            return res.status(500).json({ status: { code: 'error', message: err.message } });
        }
    });
}

async function roomExists(roomId) {
    const roomData = await db.getObject(`chat:room:${roomId}`);
    return !!roomData;
}

async function lockRoom(roomId, actingUid) {
    const now = Date.now();
    await db.setObject(`chat:room:${roomId}:adminLock`, {
        isLocked: 1,
        lockedBy: actingUid,
        lockedAt: now,
    });

    await addLockSystemMessage(roomId, actingUid, true);
    return await getRoomLockData(roomId);
}

async function unlockRoom(roomId, actingUid) {
    await db.setObject(`chat:room:${roomId}:adminLock`, {
        isLocked: 0,
        lockedBy: actingUid,
        lockedAt: 0,
    });

    await addLockSystemMessage(roomId, actingUid, false);
    return await getRoomLockData(roomId);
}

async function addLockSystemMessage(roomId, actingUid, isLocked) {
    if (typeof Messaging.addSystemMessage !== 'function') {
        return;
    }

    const messageText = isLocked ? LOCK_PREFIX + ' ' + LOCKED_MESSAGE_TEXT : LOCK_PREFIX + ' ' + UNLOCKED_MESSAGE_TEXT;

    try {
        await Messaging.addSystemMessage(messageText, actingUid, roomId);
    } catch (err) {
        console.error('[Super Admin Chats] Error adding lock system message:', err);
    }
}

async function isRoomLocked(roomId) {
    const field = await db.getObjectField(`chat:room:${roomId}:adminLock`, 'isLocked');
    return field === '1' || field === 1 || field === true;
}

async function getRoomLockData(roomId) {
    const data = await db.getObject(`chat:room:${roomId}:adminLock`) || {};
    const lockedBy = parseInt(data.lockedBy, 10) || 0;
    const lockedAt = parseInt(data.lockedAt, 10) || 0;
    const isLockedValue = data.isLocked === '1' || data.isLocked === 1 || data.isLocked === true;

    return {
        isLocked: isLockedValue,
        lockedBy,
        lockedAt,
    };
}

function appendLockNotice(messages, lockData) {
    const list = Array.isArray(messages) ? messages.slice() : [];
    if (!lockData || !lockData.isLocked || !lockData.lockedAt) {
        return list;
    }

    const content = `${LOCK_PREFIX} ${LOCKED_MESSAGE_TEXT}`;
    const exists = list.some(msg => msg && msg.content === content);
    if (exists) {
        return list;
    }

    list.push({
        content,
        fromuid: lockData.lockedBy,
        uid: lockData.lockedBy,
        timestamp: lockData.lockedAt,
        datetime: lockData.lockedAt,
        system: true,
        newSet: true,
    });

    list.sort((left, right) => {
        const leftTime = parseInt(left && (left.timestamp || left.datetime), 10) || 0;
        const rightTime = parseInt(right && (right.timestamp || right.datetime), 10) || 0;
        return leftTime - rightTime;
    });

    return list;
}

function guessRoomIdUidFromArgs(args) {
    if (!Array.isArray(args) || !args.length) {
        return { roomId: null, uid: null };
    }

    if (args.length === 1 && args[0] && typeof args[0] === 'object') {
        return {
            roomId: getRoomId(args[0]),
            uid: getCallerUid(args[0]),
        };
    }

    return {
        roomId: args[0],
        uid: args[1],
    };
}

function getCallerUid(payload) {
    return payload && (
        payload.uid ||
        payload.callerUid ||
        (payload.data && payload.data.uid) ||
        (payload.message && payload.message.uid)
    );
}

function getRoomId(payload) {
    return payload && (
        payload.roomId ||
        (payload.data && payload.data.roomId) ||
        (payload.message && payload.message.roomId)
    );
}

module.exports = plugin;
