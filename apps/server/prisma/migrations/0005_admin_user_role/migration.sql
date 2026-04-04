ALTER TABLE `admin_users`
  ADD COLUMN `role` VARCHAR(32) NOT NULL DEFAULT 'ADMIN' AFTER `password_hash`;

UPDATE `admin_users`
SET `role` = 'ADMIN'
WHERE `role` IS NULL OR TRIM(`role`) = '';
