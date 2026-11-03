INSERT INTO `ui_preference_defaults` (`key`, `value_json`)
VALUES ('sidebar.organizationMode', '"agent"')
ON CONFLICT (`key`) DO UPDATE SET `value_json` = excluded.`value_json`;
