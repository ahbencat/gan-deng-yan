// 广播辅助：大厅列表推送、房间状态推送（dispatch 与 gameSession 共用）
import { rooms } from './roomManager.js'
import { hub } from './ws/hub.js'

/** 向所有「不在任何房间」的在线用户推送大厅列表 */
export function pushLobby(): void {
  const payload = { rooms: rooms.list() }
  for (const uid of hub.onlineUserIds()) {
    if (!rooms.getByUser(uid)) hub.sendToUser(uid, 'lobby.list', payload)
  }
}

/** 向房间全体成员推送房间状态 */
export function pushRoomState(room: ReturnType<typeof rooms.get>): void {
  if (!room) return
  hub.broadcast(
    rooms.memberIds(room),
    'room.state',
    rooms.toState(room, hub.onlineUserIds()),
  )
}
