CREATE TABLE "admin_notifications" ("id" TEXT NOT NULL PRIMARY KEY, "mode" TEXT NOT NULL, "authorId" TEXT NOT NULL, "authorName" TEXT NOT NULL, "title" TEXT NOT NULL, "message" TEXT NOT NULL, "kind" TEXT NOT NULL, "priority" TEXT NOT NULL DEFAULT 'normal', "dueAt" DATETIME NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "canceledAt" DATETIME);
CREATE TABLE "admin_notification_recipients" ("id" TEXT NOT NULL PRIMARY KEY, "notificationId" TEXT NOT NULL, "adminId" TEXT NOT NULL, "readAt" DATETIME, FOREIGN KEY ("notificationId") REFERENCES "admin_notifications" ("id") ON DELETE CASCADE ON UPDATE CASCADE);
CREATE INDEX "admin_notifications_mode_dueAt_idx" ON "admin_notifications" ("mode","dueAt");
CREATE INDEX "admin_notifications_mode_authorId_createdAt_idx" ON "admin_notifications" ("mode","authorId","createdAt");
CREATE UNIQUE INDEX "admin_notification_recipients_notificationId_adminId_key" ON "admin_notification_recipients" ("notificationId","adminId");
CREATE INDEX "admin_notification_recipients_adminId_readAt_idx" ON "admin_notification_recipients" ("adminId","readAt");
