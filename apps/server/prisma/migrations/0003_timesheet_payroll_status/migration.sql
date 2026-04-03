CREATE TABLE `timesheet_payroll_status` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `week_cycle_id` INT NOT NULL,
  `employee_id` INT NOT NULL,
  `salary_total` INT NOT NULL DEFAULT 0,
  `is_paid` BOOLEAN NOT NULL DEFAULT false,
  `paid_at` DATETIME(3) NULL,
  `paid_by` VARCHAR(191) NULL,
  `note` TEXT NULL,
  `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updated_at` DATETIME(3) NOT NULL,
  UNIQUE INDEX `timesheet_payroll_status_week_cycle_id_employee_id_key`(`week_cycle_id`, `employee_id`),
  INDEX `timesheet_payroll_status_week_cycle_id_idx`(`week_cycle_id`),
  INDEX `timesheet_payroll_status_employee_id_idx`(`employee_id`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `timesheet_payroll_status`
  ADD CONSTRAINT `timesheet_payroll_status_week_cycle_id_fkey`
  FOREIGN KEY (`week_cycle_id`) REFERENCES `week_cycles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `timesheet_payroll_status`
  ADD CONSTRAINT `timesheet_payroll_status_employee_id_fkey`
  FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
