CREATE TABLE `custom_history` (
  `id` VARCHAR(191) NOT NULL,
  `mode` VARCHAR(191) NOT NULL,
  `adminId` VARCHAR(191) NOT NULL,
  `undo` JSON NOT NULL,
  `redo` JSON NOT NULL,
  `revision` INTEGER NOT NULL DEFAULT 0,
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `custom_history_mode_idx` (`mode`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
