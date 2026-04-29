from datetime import datetime
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base
from app.models.enums import ApprovalAction, Priority, RequestStatus, RequestType


class ServiceRequest(Base):
    __tablename__ = "service_requests"

    id: Mapped[int] = mapped_column(primary_key=True)
    request_number: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(180))
    request_type: Mapped[RequestType] = mapped_column(String(60), index=True)
    request_type_id: Mapped[int | None] = mapped_column(ForeignKey("request_types.id"), index=True)
    status: Mapped[RequestStatus] = mapped_column(String(40), default=RequestStatus.SUBMITTED, index=True)
    priority: Mapped[Priority] = mapped_column(String(20), default=Priority.MEDIUM)
    requester_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), index=True)
    form_data: Mapped[dict] = mapped_column(JSON, default=dict)
    business_justification: Mapped[str | None] = mapped_column(Text)
    sla_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    closed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    requester = relationship("User")
    department = relationship("Department")
    approvals: Mapped[list["ApprovalStep"]] = relationship(back_populates="request", cascade="all, delete-orphan")
    comments: Mapped[list["RequestComment"]] = relationship(back_populates="request", cascade="all, delete-orphan")
    attachments: Mapped[list["Attachment"]] = relationship(back_populates="request", cascade="all, delete-orphan")
    approval_snapshots: Mapped[list["RequestApprovalStep"]] = relationship(back_populates="request", cascade="all, delete-orphan")


class ApprovalStep(Base):
    __tablename__ = "approval_steps"

    id: Mapped[int] = mapped_column(primary_key=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("service_requests.id"), index=True)
    step_order: Mapped[int] = mapped_column(Integer)
    role: Mapped[str] = mapped_column(String(60), index=True)
    approver_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    action: Mapped[ApprovalAction] = mapped_column(String(20), default=ApprovalAction.PENDING, index=True)
    note: Mapped[str | None] = mapped_column(Text)
    acted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    request: Mapped[ServiceRequest] = relationship(back_populates="approvals")
    approver = relationship("User")


class RequestComment(Base):
    __tablename__ = "request_comments"

    id: Mapped[int] = mapped_column(primary_key=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("service_requests.id"), index=True)
    author_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    body: Mapped[str] = mapped_column(Text)
    is_internal: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    request: Mapped[ServiceRequest] = relationship(back_populates="comments")
    author = relationship("User")


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(primary_key=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("service_requests.id"), index=True)
    uploaded_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    original_name: Mapped[str] = mapped_column(String(255))
    stored_name: Mapped[str] = mapped_column(String(255), unique=True)
    content_type: Mapped[str] = mapped_column(String(120))
    size_bytes: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    request: Mapped[ServiceRequest] = relationship(back_populates="attachments")
    uploaded_by = relationship("User")


class RequestApprovalStep(Base):
    __tablename__ = "request_approval_steps"

    id: Mapped[int] = mapped_column(primary_key=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("service_requests.id", ondelete="CASCADE"), index=True)
    step_name_ar: Mapped[str] = mapped_column(String(160))
    step_name_en: Mapped[str] = mapped_column(String(160))
    step_type: Mapped[str] = mapped_column(String(80))
    approver_role_id: Mapped[int | None] = mapped_column(ForeignKey("roles.id"))
    approver_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(30), default="waiting", index=True)
    action_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    action_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    comments: Mapped[str | None] = mapped_column(Text)
    sla_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sort_order: Mapped[int] = mapped_column(Integer)

    request: Mapped[ServiceRequest] = relationship(back_populates="approval_snapshots")
