from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class InternalMessage(Base):
    __tablename__ = "internal_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    message_uid: Mapped[str | None] = mapped_column(String(40), unique=True, index=True)
    thread_id: Mapped[int | None] = mapped_column(Integer, index=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    message_type: Mapped[str] = mapped_column(String(40), default="internal_correspondence", index=True)
    subject: Mapped[str] = mapped_column(String(180))
    body: Mapped[str] = mapped_column(Text)
    related_request_id: Mapped[int | None] = mapped_column(ForeignKey("service_requests.id"), index=True)
    is_draft: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_sender_archived: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), index=True)

    sender = relationship("User", foreign_keys=[sender_id])
    related_request = relationship("ServiceRequest", foreign_keys=[related_request_id])
    recipients: Mapped[list["InternalMessageRecipient"]] = relationship(back_populates="message", cascade="all, delete-orphan")
    attachments: Mapped[list["InternalMessageAttachment"]] = relationship(back_populates="message", cascade="all, delete-orphan")


class InternalMessageRecipient(Base):
    __tablename__ = "internal_message_recipients"

    id: Mapped[int] = mapped_column(primary_key=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("internal_messages.id", ondelete="CASCADE"), index=True)
    recipient_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    message = relationship("InternalMessage", back_populates="recipients")
    recipient = relationship("User", foreign_keys=[recipient_id])


class InternalMessageAttachment(Base):
    __tablename__ = "internal_message_attachments"

    id: Mapped[int] = mapped_column(primary_key=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("internal_messages.id", ondelete="CASCADE"), index=True)
    uploaded_by_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    original_name: Mapped[str] = mapped_column(String(255))
    stored_name: Mapped[str] = mapped_column(String(255), unique=True)
    content_type: Mapped[str] = mapped_column(String(120))
    size_bytes: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    message = relationship("InternalMessage", back_populates="attachments")
    uploaded_by = relationship("User", foreign_keys=[uploaded_by_id])
