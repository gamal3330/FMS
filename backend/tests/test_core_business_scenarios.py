import unittest

from sqlalchemy import select
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app import models  # noqa: F401
from app.api.v1.requests import attachment_rules_from_snapshot, scoped_requests_stmt
from app.db.session import Base
from app.models.enums import ApprovalAction, Priority, RequestStatus, RequestType, UserRole
from app.models.request import ApprovalStep, RequestApprovalStep, ServiceRequest
from app.models.user import Department, User
from app.services.workflow import advance_workflow, reset_workflow_for_resubmission, user_can_act


class CoreBusinessScenarioTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine)
        self.db = self.Session()

    def tearDown(self):
        self.db.close()
        self.engine.dispose()

    def add_user(
        self,
        employee_id: str,
        name: str,
        role: UserRole,
        *,
        department: Department | None = None,
        manager: User | None = None,
    ) -> User:
        user = User(
            employee_id=employee_id,
            username=employee_id,
            full_name_ar=name,
            full_name_en=name,
            email=f"{employee_id}@qib.test",
            hashed_password="not-used-in-scenario-tests",
            role=role,
            department_id=department.id if department else None,
            manager_id=manager.id if manager else None,
            is_active=True,
        )
        self.db.add(user)
        self.db.flush()
        return user

    def add_department(self, code: str, name: str, manager: User | None = None) -> Department:
        department = Department(
            code=code,
            name_ar=name,
            name_en=code,
            manager_id=manager.id if manager else None,
            is_active=True,
        )
        self.db.add(department)
        self.db.flush()
        return department

    def add_request(
        self,
        requester: User,
        department: Department,
        *,
        title: str = "طلب سيناريو",
        request_number: str = "QIB-2026-000001",
        workflow: list[dict] | None = None,
    ) -> ServiceRequest:
        service_request = ServiceRequest(
            request_number=request_number,
            title=title,
            request_type=RequestType.SUPPORT,
            status=RequestStatus.PENDING_APPROVAL,
            priority=Priority.MEDIUM,
            requester_id=requester.id,
            department_id=department.id,
            form_data={},
            request_type_snapshot={"workflow": workflow or []},
            form_schema_snapshot=[],
        )
        self.db.add(service_request)
        self.db.flush()
        return service_request

    def add_step(
        self,
        service_request: ServiceRequest,
        order: int,
        role: str,
        *,
        can_reject: bool = True,
        can_return_for_edit: bool = False,
        status_value: str = "waiting",
    ) -> ApprovalStep:
        step = ApprovalStep(
            request_id=service_request.id,
            step_order=order,
            role=role,
            action=ApprovalAction.PENDING,
        )
        snapshot = RequestApprovalStep(
            request_id=service_request.id,
            step_name_ar=role,
            step_name_en=role,
            step_type=role,
            status="pending" if order == 1 else status_value,
            sort_order=order,
        )
        self.db.add_all([step, snapshot])
        service_request.request_type_snapshot = {
            "workflow": [
                *service_request.request_type_snapshot.get("workflow", []),
                {
                    "sort_order": order,
                    "step_type": role,
                    "can_reject": can_reject,
                    "can_return_for_edit": can_return_for_edit,
                    "is_active": True,
                },
            ]
        }
        self.db.flush()
        return step

    def test_employee_direct_manager_department_manager_then_specialist_flow(self):
        direct_manager = self.add_user("dm", "المدير المباشر", UserRole.DIRECT_MANAGER)
        department_manager = self.add_user("deptmgr", "مدير الإدارة", UserRole.DEPARTMENT_MANAGER)
        department = self.add_department("finance", "الإدارة المالية", department_manager)
        department_manager.department_id = department.id
        requester = self.add_user("emp", "موظف مقدم الطلب", UserRole.EMPLOYEE, department=department, manager=direct_manager)
        specialist = self.add_user("specialist", "مختص الإدارة", UserRole.EMPLOYEE, department=department)
        service_request = self.add_request(requester, department)
        first_step = self.add_step(service_request, 1, UserRole.DIRECT_MANAGER.value)
        second_step = self.add_step(service_request, 2, "department_manager")
        third_step = self.add_step(service_request, 3, "department_specialist")

        self.assertTrue(user_can_act(self.db, service_request, direct_manager, first_step))
        self.assertFalse(user_can_act(self.db, service_request, department_manager, first_step))

        advance_workflow(self.db, service_request, direct_manager, ApprovalAction.APPROVED, "موافق")
        self.assertEqual(first_step.action, ApprovalAction.APPROVED)
        self.assertEqual(service_request.status, RequestStatus.PENDING_APPROVAL)
        self.assertTrue(user_can_act(self.db, service_request, department_manager, second_step))

        advance_workflow(self.db, service_request, department_manager, ApprovalAction.APPROVED, "موافق")
        self.assertTrue(user_can_act(self.db, service_request, specialist, third_step))

        advance_workflow(self.db, service_request, specialist, ApprovalAction.APPROVED, "تم التنفيذ")
        self.assertEqual(service_request.status, RequestStatus.CLOSED)
        self.assertIsNotNone(service_request.closed_at)

    def test_reject_and_return_flags_are_enforced_from_workflow_snapshot(self):
        direct_manager = self.add_user("dm", "المدير المباشر", UserRole.DIRECT_MANAGER)
        department = self.add_department("ops", "العمليات")
        requester = self.add_user("emp", "موظف", UserRole.EMPLOYEE, department=department, manager=direct_manager)
        service_request = self.add_request(requester, department)
        self.add_step(service_request, 1, UserRole.DIRECT_MANAGER.value, can_reject=False, can_return_for_edit=False)

        with self.assertRaises(PermissionError):
            advance_workflow(self.db, service_request, direct_manager, ApprovalAction.REJECTED, "رفض")

        with self.assertRaises(PermissionError):
            advance_workflow(self.db, service_request, direct_manager, ApprovalAction.RETURNED_FOR_EDIT, "إرجاع")

    def test_return_for_edit_and_resubmit_restart_pending_steps(self):
        direct_manager = self.add_user("dm", "المدير المباشر", UserRole.DIRECT_MANAGER)
        department = self.add_department("branches", "إدارة الفروع")
        requester = self.add_user("emp", "موظف", UserRole.EMPLOYEE, department=department, manager=direct_manager)
        service_request = self.add_request(requester, department)
        first_step = self.add_step(service_request, 1, UserRole.DIRECT_MANAGER.value, can_return_for_edit=True)
        second_step = self.add_step(service_request, 2, "department_manager")

        advance_workflow(self.db, service_request, direct_manager, ApprovalAction.RETURNED_FOR_EDIT, "استكمال بيانات")
        self.assertEqual(first_step.action, ApprovalAction.RETURNED_FOR_EDIT)
        self.assertEqual(service_request.status, RequestStatus.RETURNED_FOR_EDIT)

        reset_workflow_for_resubmission(service_request)
        self.assertEqual(service_request.status, RequestStatus.PENDING_APPROVAL)
        self.assertEqual(first_step.action, ApprovalAction.PENDING)
        self.assertEqual(second_step.action, ApprovalAction.PENDING)

    def test_department_manager_scope_is_limited_to_managed_department(self):
        manager = self.add_user("mgr1", "مدير الإدارة الأولى", UserRole.DEPARTMENT_MANAGER)
        other_manager = self.add_user("mgr2", "مدير الإدارة الثانية", UserRole.DEPARTMENT_MANAGER)
        department = self.add_department("dept1", "الإدارة الأولى", manager)
        other_department = self.add_department("dept2", "الإدارة الثانية", other_manager)
        requester = self.add_user("emp1", "موظف أول", UserRole.EMPLOYEE, department=department)
        other_requester = self.add_user("emp2", "موظف ثان", UserRole.EMPLOYEE, department=other_department)
        visible_request = self.add_request(requester, department, request_number="QIB-2026-000101")
        hidden_request = self.add_request(other_requester, other_department, request_number="QIB-2026-000102")

        rows = self.db.scalars(scoped_requests_stmt(select(ServiceRequest), manager, self.db)).all()

        self.assertIn(visible_request.id, {row.id for row in rows})
        self.assertNotIn(hidden_request.id, {row.id for row in rows})

    def test_disabled_attachment_rules_keep_uploads_unavailable(self):
        rules = attachment_rules_from_snapshot(
            {
                "requires_attachment": False,
                "allow_multiple_attachments": False,
                "max_attachments": 1,
                "max_file_size_mb": 10,
                "allowed_extensions_json": ["pdf"],
            }
        )

        self.assertFalse(rules["attachments_enabled"])
        self.assertFalse(rules["requires_attachment"])
        self.assertEqual(rules["max_attachments"], 1)


if __name__ == "__main__":
    unittest.main()
