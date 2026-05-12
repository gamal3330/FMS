from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class InternalMessage(Base):
    __tablename__ = "internal_messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    message_uid: Mapped[str | None] = mapped_column(String(40), unique=True, index=True)
    thread_id: Mapped[int | None] = mapped_column(Integer, index=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    message_type: Mapped[str] = mapped_column(String(40), default="internal_correspondence", index=True)
    priority: Mapped[str] = mapped_column(String(20), default="normal", index=True)
    classification_code: Mapped[str] = mapped_column(String(80), default="internal", index=True)
    subject: Mapped[str] = mapped_column(String(180))
    body: Mapped[str] = mapped_column(Text)
    related_request_id: Mapped[int | None] = mapped_column(ForeignKey("service_requests.id"), index=True)
    is_official: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    official_reference_number: Mapped[str | None] = mapped_column(String(80), index=True)
    include_in_request_pdf: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    official_pdf_document_id: Mapped[int | None] = mapped_column(Integer, index=True)
    official_status: Mapped[str | None] = mapped_column(String(40), default="sent", index=True)
    is_draft: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_sender_archived: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_sender_deleted: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), index=True)

    sender = relationship("User", foreign_keys=[sender_id])
    related_request = relationship("ServiceRequest", foreign_keys=[related_request_id])
    recipients: Mapped[list["InternalMessageRecipient"]] = relationship(back_populates="message", cascade="all, delete-orphan")
    attachments: Mapped[list["InternalMessageAttachment"]] = relationship(back_populates="message", cascade="all, delete-orphan")
    official_documents: Mapped[list["OfficialMessageDocument"]] = relationship(back_populates="message", cascade="all, delete-orphan")


class InternalMessageRecipient(Base):
    __tablename__ = "internal_message_recipients"

    id: Mapped[int] = mapped_column(primary_key=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("internal_messages.id", ondelete="CASCADE"), index=True)
    recipient_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_deleted: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

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


class OfficialLetterheadTemplate(Base):
    __tablename__ = "official_letterhead_templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    name_ar: Mapped[str] = mapped_column(String(160))
    name_en: Mapped[str | None] = mapped_column(String(160))
    code: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    logo_path: Mapped[str | None] = mapped_column(String(500))
    template_pdf_path: Mapped[str | None] = mapped_column(String(500))
    header_html: Mapped[str | None] = mapped_column(Text)
    footer_html: Mapped[str | None] = mapped_column(Text)
    primary_color: Mapped[str] = mapped_column(String(20), default="#0f5132")
    secondary_color: Mapped[str] = mapped_column(String(20), default="#9bd84e")
    show_page_number: Mapped[bool] = mapped_column(Boolean, default=True)
    show_confidentiality_label: Mapped[bool] = mapped_column(Boolean, default=True)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    creator = relationship("User", foreign_keys=[created_by])


class UserSignature(Base):
    __tablename__ = "user_signatures"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    signature_image_path: Mapped[str] = mapped_column(String(500))
    signature_label: Mapped[str | None] = mapped_column(String(160))
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    verified_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    user = relationship("User", foreign_keys=[user_id])
    verifier = relationship("User", foreign_keys=[verified_by])


class OfficialStamp(Base):
    __tablename__ = "official_stamps"

    id: Mapped[int] = mapped_column(primary_key=True)
    name_ar: Mapped[str] = mapped_column(String(160))
    code: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    stamp_image_path: Mapped[str] = mapped_column(String(500))
    allowed_roles_json: Mapped[list] = mapped_column(JSON, default=list)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    creator = relationship("User", foreign_keys=[created_by])


class OfficialMessageDocument(Base):
    __tablename__ = "official_message_documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("internal_messages.id", ondelete="CASCADE"), index=True)
    related_request_id: Mapped[int | None] = mapped_column(ForeignKey("service_requests.id"), index=True)
    letterhead_template_id: Mapped[int] = mapped_column(ForeignKey("official_letterhead_templates.id"), index=True)
    signature_id: Mapped[int | None] = mapped_column(ForeignKey("user_signatures.id"), index=True)
    stamp_id: Mapped[int | None] = mapped_column(ForeignKey("official_stamps.id"), index=True)
    reference_number: Mapped[str | None] = mapped_column(String(80), index=True)
    pdf_file_path: Mapped[str] = mapped_column(String(500))
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    checksum: Mapped[str] = mapped_column(String(128), index=True)
    generated_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    message = relationship("InternalMessage", back_populates="official_documents")
    related_request = relationship("ServiceRequest", foreign_keys=[related_request_id])
    template = relationship("OfficialLetterheadTemplate", foreign_keys=[letterhead_template_id])
    signature = relationship("UserSignature", foreign_keys=[signature_id])
    stamp = relationship("OfficialStamp", foreign_keys=[stamp_id])
    generator = relationship("User", foreign_keys=[generated_by])


class OfficialMessageSettings(Base):
    __tablename__ = "official_message_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    default_letterhead_template_id: Mapped[int | None] = mapped_column(ForeignKey("official_letterhead_templates.id"))
    enable_official_letterhead: Mapped[bool] = mapped_column(Boolean, default=True)
    official_message_requires_approval: Mapped[bool] = mapped_column(Boolean, default=False)
    allow_unverified_signature: Mapped[bool] = mapped_column(Boolean, default=False)
    allow_signature_upload_by_user: Mapped[bool] = mapped_column(Boolean, default=True)
    include_official_messages_in_request_pdf: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    default_letterhead_template = relationship("OfficialLetterheadTemplate", foreign_keys=[default_letterhead_template_id])
