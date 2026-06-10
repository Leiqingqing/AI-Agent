import { Hono } from 'hono'

import meetingRoomChat from './meetingRoomChat'

const realtimeRoutes = new Hono()

realtimeRoutes.route('/meeting-room-chat', meetingRoomChat)

export default realtimeRoutes