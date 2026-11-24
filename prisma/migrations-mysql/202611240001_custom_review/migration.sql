ALTER TABLE `custom_rows` ADD COLUMN `reviewChecked` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `custom_rows` ADD COLUMN `reviewFlag` VARCHAR(191) NULL;
ALTER TABLE `custom_rows` ADD COLUMN `reviewNote` TEXT NULL;
