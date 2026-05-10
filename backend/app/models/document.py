from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class DocumentCategory(Base):
    __tablename__ = "document_categories"
    __table_args__ = (UniqueConstraint("code", name="uq_document_category_code"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name_ar: Mapped[str] = mapped_column(String(160), index=True)
    name_en: Mapped[str | None] = mapped_column(String(160), index=True)
    code: Mapped[str] = mapped_column(String(80), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    icon: Mapped[str | None] = mapped_column(String(80))
    color: Mapped[str | None] = mapped_column(String(30))
    sort_order: Mapped[int] = mapped_column(Integer, default=0, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    documents: Mapped[list["Document"]] = relationship(back_populates="category")


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("document_categories.id"), index=True)
    title_ar: Mapped[str] = mapped_column(String(255), index=True)
    title_en: Mapped[str | None] = mapped_column(String(255), index=True)
    document_number: Mapped[str | None] = mapped_column(String(120), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    owner_department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), index=True)
    classification: Mapped[str] = mapped_column(String(40), default="internal", index=True)
    status: Mapped[str] = mapped_column(String(40), default="active", index=True)
    current_version_id: Mapped[int | None] = mapped_column(ForeignKey("document_versions.id"))
    requires_acknowledgement: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    keywords: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    category: Mapped[DocumentCategory] = relationship(back_populates="documents")
    owner_department = relationship("Department")
    creator = relationship("User", foreign_keys=[created_by])
    current_version = relationship("DocumentVersion", foreign_keys=[current_version_id], post_update=True)
    versions: Mapped[list["DocumentVersion"]] = relationship(
        back_populates="document",
        cascade="all, delete-orphan",
        foreign_keys="DocumentVersion.document_id",
        order_by="DocumentVersion.uploaded_at.desc()",
    )


class DocumentVersion(Base):
    __tablename__ = "document_versions"
    __table_args__ = (UniqueConstraint("document_id", "version_number", name="uq_document_version_number"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    version_number: Mapped[int] = mapped_column(Integer, default=1, index=True)
    file_name: Mapped[str] = mapped_column(String(255))
    file_path: Mapped[str] = mapped_column(String(500))
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    mime_type: Mapped[str] = mapped_column(String(120), default="application/pdf")
    checksum: Mapped[str] = mapped_column(String(128), index=True)
    issue_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    effective_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    review_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"))
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    change_summary: Mapped[str | None] = mapped_column(Text)
    is_current: Mapped[bool] = mapped_column(Boolean, default=False, index=True)

    document: Mapped[Document] = relationship(back_populates="versions", foreign_keys=[document_id])
    uploader = relationship("User", foreign_keys=[uploaded_by])


class DocumentPermission(Base):
    __tablename__ = "document_permissions"

    id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("document_categories.id"), index=True)
    document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id"), index=True)
    role_id: Mapped[int | None] = mapped_column(ForeignKey("roles.id"), index=True)
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id"), index=True)
    can_view: Mapped[bool] = mapped_column(Boolean, default=True)
    can_download: Mapped[bool] = mapped_column(Boolean, default=True)
    can_print: Mapped[bool] = mapped_column(Boolean, default=True)
    can_manage: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    category = relationship("DocumentCategory")
    document = relationship("Document")
    role = relationship("Role")
    department = relationship("Department")


class DocumentAccessLog(Base):
    __tablename__ = "document_access_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"), index=True)
    version_id: Mapped[int | None] = mapped_column(ForeignKey("document_versions.id"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True)
    action: Mapped[str] = mapped_column(String(80), index=True)
    ip_address: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    document = relationship("Document")
    version = relationship("DocumentVersion")
    user = relationship("User")


class DocumentAcknowledgement(Base):
    __tablename__ = "document_acknowledgements"
    __table_args__ = (UniqueConstraint("document_id", "version_id", "user_id", name="uq_document_acknowledgement"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id"), index=True)
    version_id: Mapped[int] = mapped_column(ForeignKey("document_versions.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    acknowledged_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    document = relationship("Document")
    version = relationship("DocumentVersion")
    user = relationship("User")


class RequestTypeDocument(Base):
    __tablename__ = "request_type_documents"
    __table_args__ = (UniqueConstraint("request_type_id", "document_id", name="uq_request_type_document"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    request_type_id: Mapped[int] = mapped_column(ForeignKey("request_types.id", ondelete="CASCADE"), index=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("documents.id", ondelete="CASCADE"), index=True)
    is_required_reading: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    request_type = relationship("RequestTypeSetting")
    document = relationship("Document")
