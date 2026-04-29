import unittest

from app.api.v1.health import bytes_label, check_status_from_thresholds, overall_status


class HealthMonitoringRulesTests(unittest.TestCase):
    def test_disk_thresholds(self):
        self.assertEqual(check_status_from_thresholds(80, 80, 90), "healthy")
        self.assertEqual(check_status_from_thresholds(85, 80, 90), "warning")
        self.assertEqual(check_status_from_thresholds(91, 80, 90), "critical")

    def test_errors_thresholds(self):
        self.assertEqual(check_status_from_thresholds(10, 10, 50), "healthy")
        self.assertEqual(check_status_from_thresholds(11, 10, 50), "warning")
        self.assertEqual(check_status_from_thresholds(51, 10, 50), "critical")

    def test_overall_status(self):
        self.assertEqual(overall_status([{"status": "healthy"}, {"status": "healthy"}]), "healthy")
        self.assertEqual(overall_status([{"status": "healthy"}, {"status": "warning"}]), "warning")
        self.assertEqual(overall_status([{"status": "warning"}, {"status": "critical"}]), "critical")

    def test_bytes_label(self):
        self.assertEqual(bytes_label(0), "0 B")
        self.assertEqual(bytes_label(1024), "1.0 KB")


if __name__ == "__main__":
    unittest.main()
