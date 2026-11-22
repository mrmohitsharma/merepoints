-- Super Admin sets what 1 point is worth for everyone, and can lock it so shop owners cannot change it.
INSERT INTO platform_settings (key, value) VALUES
 ('default_point_value_rupees', '0.25'),
 ('point_value_locked', 'false')
ON CONFLICT (key) DO NOTHING;
