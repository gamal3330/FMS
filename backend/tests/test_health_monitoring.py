import unittest

from app.api.v1.health import bytes_label, overall_status, threshold_status


class HealthMonitoringRulesTests(unittest.TestCase):
    def test_disk_thresholds(self):
        self.assertEqual(threshold_status(79, 80, 90), "healthy")
        self.assertEqual(threshold_status(80, 80, 90), "warning")
        self.assertEqual(threshold_status(90, 80, 90), "critical")

    def test_errors_thresholds(self):
        self.assertEqual(threshold_status(9, 10, 50), "healthy")
        self.assertEqual(threshold_status(10, 10, 50), "warning")
        self.assertEqual(threshold_status(50, 10, 50), "critical")

    def test_overall_status(self):
        self.assertEqual(overall_status([{"status": "healthy"}, {"status": "healthy"}]), "healthy")
        self.assertEqual(overall_status([{"status": "healthy"}, {"status": "warning"}]), "warning")
        self.assertEqual(overall_status([{"status": "warning"}, {"status": "critical"}]), "critical")

    def test_bytes_label(self):
        self.assertEqual(bytes_label(0), "0 B")
        self.assertEqual(bytes_label(1024), "1.0 KB")


if __name__ == "__main__":
    unittest.main()
