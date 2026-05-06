from pydantic import BaseModel


class DashboardStats(BaseModel):
    open_requests: int
    pending_approvals: int
    completed_requests: int
    delayed_requests: int
    monthly_statistics: list[dict]
    requests_by_department: list[dict]
    requests_by_status: list[dict] = []
    requests_by_type: list[dict] = []
    messages: dict = {}
    recent_requests: list[dict] = []
    attention_items: list[dict] = []
    can_view_it_staff_statistics: bool = False
    it_staff_statistics: list[dict] = []
