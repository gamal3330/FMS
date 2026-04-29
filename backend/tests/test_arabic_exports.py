from datetime import datetime
from types import SimpleNamespace
import unittest

from openpyxl import load_workbook

from app.api.v1.reports import build_excel_report, build_pdf_report, report_rows, rtl


def sample_request():
    return SimpleNamespace(
        request_number="QIB-2026-000001",
        title="طلب صلاحية شبكة",
        requester=SimpleNamespace(full_name_ar="عبدالله باجرش"),
        department=SimpleNamespace(name_ar="قسم الشبكات"),
        request_type="network_access",
        form_data={"request_type_label": "صلاحية شبكة"},
        status="pending_approval",
        priority="medium",
        created_at=datetime(2026, 4, 29, 10, 30),
    )


class ArabicExportTests(unittest.TestCase):
    def test_report_rows_keep_arabic_text(self):
        rows = report_rows([sample_request()])

        self.assertEqual(rows[0][1], "طلب صلاحية شبكة")
        self.assertEqual(rows[0][2], "عبدالله باجرش")
        self.assertEqual(rows[0][3], "قسم الشبكات")
        self.assertEqual(rows[0][5], "بانتظار الموافقة")

    def test_excel_export_uses_rtl_sheet_and_right_alignment(self):
        stream = build_excel_report([sample_request()])
        workbook = load_workbook(stream)
        sheet = workbook.active

        self.assertTrue(sheet.sheet_view.rightToLeft)
        self.assertEqual(sheet["A1"].value, "رقم الطلب")
        self.assertEqual(sheet["B2"].value, "طلب صلاحية شبكة")
        self.assertEqual(sheet["C2"].value, "عبدالله باجرش")
        self.assertEqual(sheet["A1"].alignment.horizontal, "right")
        self.assertEqual(sheet["B2"].alignment.horizontal, "right")
        self.assertEqual(sheet["B2"].alignment.readingOrder, 2.0)

    def test_pdf_export_is_generated_with_reshaped_arabic(self):
        shaped = rtl("تقرير الطلبات")
        stream = build_pdf_report([sample_request()])
        data = stream.getvalue()

        self.assertNotEqual(shaped, "تقرير الطلبات")
        self.assertTrue(data.startswith(b"%PDF"))
        self.assertGreater(len(data), 1000)


if __name__ == "__main__":
    unittest.main()
