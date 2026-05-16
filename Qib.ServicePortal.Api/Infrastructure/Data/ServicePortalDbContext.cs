using Microsoft.EntityFrameworkCore;
using Qib.ServicePortal.Api.Domain.Entities;
using RequestEntity = Qib.ServicePortal.Api.Domain.Entities.Request;

namespace Qib.ServicePortal.Api.Infrastructure.Data;

public class ServicePortalDbContext(DbContextOptions<ServicePortalDbContext> options) : DbContext(options)
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Role> Roles => Set<Role>();
    public DbSet<Permission> Permissions => Set<Permission>();
    public DbSet<RolePermission> RolePermissions => Set<RolePermission>();
    public DbSet<UserPermissionOverride> UserPermissionOverrides => Set<UserPermissionOverride>();
    public DbSet<Department> Departments => Set<Department>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();
    public DbSet<Notification> Notifications => Set<Notification>();
    public DbSet<SystemSetting> SystemSettings => Set<SystemSetting>();
    public DbSet<SpecializedSection> SpecializedSections => Set<SpecializedSection>();
    public DbSet<PrioritySetting> PrioritySettings => Set<PrioritySetting>();
    public DbSet<SlaRule> SlaRules => Set<SlaRule>();
    public DbSet<RequestType> RequestTypes => Set<RequestType>();
    public DbSet<RequestTypeVersion> RequestTypeVersions => Set<RequestTypeVersion>();
    public DbSet<RequestTypeField> RequestTypeFields => Set<RequestTypeField>();
    public DbSet<WorkflowTemplateStep> WorkflowTemplateSteps => Set<WorkflowTemplateStep>();
    public DbSet<RequestTypeSettings> RequestTypeSettings => Set<RequestTypeSettings>();
    public DbSet<RequestEntity> Requests => Set<RequestEntity>();
    public DbSet<RequestFieldSnapshot> RequestFieldSnapshots => Set<RequestFieldSnapshot>();
    public DbSet<RequestWorkflowSnapshot> RequestWorkflowSnapshots => Set<RequestWorkflowSnapshot>();
    public DbSet<RequestAttachment> RequestAttachments => Set<RequestAttachment>();
    public DbSet<RequestStatusHistory> RequestStatusHistory => Set<RequestStatusHistory>();
    public DbSet<RequestComment> RequestComments => Set<RequestComment>();
    public DbSet<RequestExecutionLog> RequestExecutionLogs => Set<RequestExecutionLog>();
    public DbSet<RequestSlaTracking> RequestSlaTracking => Set<RequestSlaTracking>();
    public DbSet<Message> Messages => Set<Message>();
    public DbSet<MessageRecipient> MessageRecipients => Set<MessageRecipient>();
    public DbSet<MessageAttachment> MessageAttachments => Set<MessageAttachment>();
    public DbSet<MessageType> MessageTypes => Set<MessageType>();
    public DbSet<MessageClassification> MessageClassifications => Set<MessageClassification>();
    public DbSet<MessageTemplate> MessageTemplates => Set<MessageTemplate>();
    public DbSet<OfficialLetterheadTemplate> OfficialLetterheadTemplates => Set<OfficialLetterheadTemplate>();
    public DbSet<OfficialMessageSettings> OfficialMessageSettings => Set<OfficialMessageSettings>();
    public DbSet<OfficialMessageDocument> OfficialMessageDocuments => Set<OfficialMessageDocument>();
    public DbSet<DocumentCategory> DocumentCategories => Set<DocumentCategory>();
    public DbSet<Document> Documents => Set<Document>();
    public DbSet<DocumentVersion> DocumentVersions => Set<DocumentVersion>();
    public DbSet<DocumentPermission> DocumentPermissions => Set<DocumentPermission>();
    public DbSet<DocumentAccessLog> DocumentAccessLogs => Set<DocumentAccessLog>();
    public DbSet<DocumentAcknowledgement> DocumentAcknowledgements => Set<DocumentAcknowledgement>();
    public DbSet<UserSession> UserSessions => Set<UserSession>();
    public DbSet<UserLoginAttempt> UserLoginAttempts => Set<UserLoginAttempt>();
    public DbSet<SystemHealthCheck> SystemHealthChecks => Set<SystemHealthCheck>();
    public DbSet<SystemHealthAlert> SystemHealthAlerts => Set<SystemHealthAlert>();
    public DbSet<SystemHealthMetric> SystemHealthMetrics => Set<SystemHealthMetric>();
    public DbSet<SystemHealthSettings> SystemHealthSettings => Set<SystemHealthSettings>();
    public DbSet<DatabaseBackup> DatabaseBackups => Set<DatabaseBackup>();
    public DbSet<DatabaseJob> DatabaseJobs => Set<DatabaseJob>();
    public DbSet<DatabaseMaintenanceLog> DatabaseMaintenanceLogs => Set<DatabaseMaintenanceLog>();
    public DbSet<DatabaseRestoreJob> DatabaseRestoreJobs => Set<DatabaseRestoreJob>();
    public DbSet<RollbackPoint> RollbackPoints => Set<RollbackPoint>();
    public DbSet<SystemVersion> SystemVersions => Set<SystemVersion>();
    public DbSet<UpdatePackage> UpdatePackages => Set<UpdatePackage>();
    public DbSet<UpdateJob> UpdateJobs => Set<UpdateJob>();
    public DbSet<UpdateLog> UpdateLogs => Set<UpdateLog>();
    public DbSet<UpdateHistory> UpdateHistory => Set<UpdateHistory>();
    public DbSet<SavedReport> SavedReports => Set<SavedReport>();
    public DbSet<ReportTemplate> ReportTemplates => Set<ReportTemplate>();
    public DbSet<ScheduledReport> ScheduledReports => Set<ScheduledReport>();
    public DbSet<ReportExportLog> ReportExportLogs => Set<ReportExportLog>();
    public DbSet<AiSettings> AiSettings => Set<AiSettings>();
    public DbSet<AiUsageLog> AiUsageLogs => Set<AiUsageLog>();
    public DbSet<AiPromptTemplate> AiPromptTemplates => Set<AiPromptTemplate>();
    public DbSet<AiHealthCheck> AiHealthChecks => Set<AiHealthCheck>();
    public DbSet<AiFeaturePermission> AiFeaturePermissions => Set<AiFeaturePermission>();
    public DbSet<AiFeedback> AiFeedback => Set<AiFeedback>();
    public DbSet<MessagingSettings> MessagingSettings => Set<MessagingSettings>();
    public DbSet<MessageAttachmentSettings> MessageAttachmentSettings => Set<MessageAttachmentSettings>();
    public DbSet<MessageNotificationSettings> MessageNotificationSettings => Set<MessageNotificationSettings>();
    public DbSet<MessageRequestIntegrationSettings> MessageRequestIntegrationSettings => Set<MessageRequestIntegrationSettings>();
    public DbSet<MessageRetentionPolicy> MessageRetentionPolicies => Set<MessageRetentionPolicy>();
    public DbSet<MessageSecurityPolicy> MessageSecurityPolicies => Set<MessageSecurityPolicy>();
    public DbSet<MessageAiSettings> MessageAiSettings => Set<MessageAiSettings>();
    public DbSet<MessageAutoRule> MessageAutoRules => Set<MessageAutoRule>();
    public DbSet<UserSignature> UserSignatures => Set<UserSignature>();
    public DbSet<RequestTypeDocument> RequestTypeDocuments => Set<RequestTypeDocument>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(entity =>
        {
            entity.ToTable("users");
            entity.HasIndex(x => x.Username).IsUnique();
            entity.HasIndex(x => x.Email).IsUnique();
            entity.HasIndex(x => x.EmployeeNumber).IsUnique();
            entity.Property(x => x.Username).HasMaxLength(100);
            entity.Property(x => x.Email).HasMaxLength(255);
            entity.Property(x => x.NameAr).HasMaxLength(255);
            entity.Property(x => x.RelationshipType).HasMaxLength(80).HasDefaultValue("employee");
            entity.HasOne(x => x.Role).WithMany(x => x.Users).HasForeignKey(x => x.RoleId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(x => x.Department).WithMany(x => x.Users).HasForeignKey(x => x.DepartmentId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(x => x.SpecializedSection).WithMany().HasForeignKey(x => x.SpecializedSectionId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(x => x.DirectManager).WithMany(x => x.DirectReports).HasForeignKey(x => x.DirectManagerId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<Role>(entity =>
        {
            entity.ToTable("roles");
            entity.HasIndex(x => x.Code).IsUnique();
            entity.Property(x => x.Code).HasMaxLength(100);
            entity.Property(x => x.NameAr).HasMaxLength(255);
        });

        modelBuilder.Entity<Permission>(entity =>
        {
            entity.ToTable("permissions");
            entity.HasIndex(x => x.Code).IsUnique();
            entity.Property(x => x.Code).HasMaxLength(150);
            entity.Property(x => x.Module).HasMaxLength(100);
            entity.Property(x => x.NameAr).HasMaxLength(255);
        });

        modelBuilder.Entity<RolePermission>(entity =>
        {
            entity.ToTable("role_permissions");
            entity.HasKey(x => new { x.RoleId, x.PermissionId });
            entity.HasOne(x => x.Role).WithMany(x => x.RolePermissions).HasForeignKey(x => x.RoleId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.Permission).WithMany(x => x.RolePermissions).HasForeignKey(x => x.PermissionId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<UserPermissionOverride>(entity =>
        {
            entity.ToTable("user_permission_overrides");
            entity.HasKey(x => new { x.UserId, x.PermissionId });
            entity.HasOne(x => x.User).WithMany(x => x.PermissionOverrides).HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.Permission).WithMany(x => x.UserOverrides).HasForeignKey(x => x.PermissionId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Department>(entity =>
        {
            entity.ToTable("departments");
            entity.HasIndex(x => x.Code).IsUnique();
            entity.Property(x => x.Code).HasMaxLength(100);
            entity.Property(x => x.NameAr).HasMaxLength(255);
            entity.HasOne(x => x.ParentDepartment).WithMany(x => x.Children).HasForeignKey(x => x.ParentDepartmentId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(x => x.ManagerUser).WithMany().HasForeignKey(x => x.ManagerUserId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<RefreshToken>(entity =>
        {
            entity.ToTable("refresh_tokens");
            entity.HasIndex(x => x.TokenHash).IsUnique();
            entity.HasOne(x => x.User).WithMany(x => x.RefreshTokens).HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<AuditLog>(entity =>
        {
            entity.ToTable("audit_logs");
            entity.HasIndex(x => x.CreatedAt);
            entity.HasIndex(x => x.Action);
            entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<Notification>(entity =>
        {
            entity.ToTable("notifications");
            entity.HasIndex(x => new { x.UserId, x.IsRead, x.CreatedAt });
            entity.HasIndex(x => x.Channel);
            entity.Property(x => x.Title).HasMaxLength(255);
            entity.Property(x => x.Channel).HasMaxLength(80);
            entity.Property(x => x.RelatedRoute).HasMaxLength(300);
            entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<SystemSetting>(entity =>
        {
            entity.ToTable("system_settings");
            entity.HasIndex(x => x.Key).IsUnique();
            entity.Property(x => x.Key).HasMaxLength(150);
            entity.Property(x => x.Group).HasMaxLength(100);
            entity.HasOne(x => x.UpdatedByUser).WithMany().HasForeignKey(x => x.UpdatedByUserId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<SpecializedSection>(entity =>
        {
            entity.ToTable("specialized_sections");
            entity.HasIndex(x => x.Code).IsUnique();
            entity.Property(x => x.Code).HasMaxLength(100);
            entity.Property(x => x.NameAr).HasMaxLength(255);
            entity.Property(x => x.AutoAssignStrategy).HasMaxLength(60);
            entity.HasOne(x => x.Department).WithMany().HasForeignKey(x => x.DepartmentId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(x => x.ManagerUser).WithMany().HasForeignKey(x => x.ManagerUserId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(x => x.DefaultAssigneeUser).WithMany().HasForeignKey(x => x.DefaultAssigneeUserId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<PrioritySetting>(entity =>
        {
            entity.ToTable("priority_settings");
            entity.HasIndex(x => x.Code).IsUnique();
            entity.Property(x => x.Code).HasMaxLength(50);
            entity.Property(x => x.NameAr).HasMaxLength(100);
            entity.Property(x => x.Color).HasMaxLength(30);
        });

        modelBuilder.Entity<SlaRule>(entity =>
        {
            entity.ToTable("sla_rules");
            entity.HasOne(x => x.RequestType).WithMany(x => x.SlaRules).HasForeignKey(x => x.RequestTypeId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.EscalationUser).WithMany().HasForeignKey(x => x.EscalationUserId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(x => x.EscalationRole).WithMany().HasForeignKey(x => x.EscalationRoleId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<RequestType>(entity =>
        {
            entity.ToTable("request_types");
            entity.HasIndex(x => x.Code).IsUnique();
            entity.Property(x => x.Code).HasMaxLength(100);
            entity.Property(x => x.NameAr).HasMaxLength(255);
            entity.HasOne(x => x.SpecializedSection).WithMany().HasForeignKey(x => x.SpecializedSectionId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(x => x.CurrentVersion).WithMany().HasForeignKey(x => x.CurrentVersionId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<RequestTypeVersion>(entity =>
        {
            entity.ToTable("request_type_versions");
            entity.HasIndex(x => new { x.RequestTypeId, x.VersionNumber }).IsUnique();
            entity.Property(x => x.Status).HasMaxLength(30);
            entity.HasOne(x => x.RequestType).WithMany(x => x.Versions).HasForeignKey(x => x.RequestTypeId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.CreatedByUser).WithMany().HasForeignKey(x => x.CreatedByUserId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<RequestTypeField>(entity =>
        {
            entity.ToTable("request_type_fields");
            entity.HasIndex(x => new { x.VersionId, x.FieldName }).IsUnique();
            entity.Property(x => x.FieldName).HasMaxLength(100);
            entity.Property(x => x.LabelAr).HasMaxLength(255);
            entity.Property(x => x.FieldType).HasMaxLength(60);
            entity.Property(x => x.Width).HasMaxLength(30);
            entity.HasOne(x => x.Version).WithMany(x => x.Fields).HasForeignKey(x => x.VersionId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<WorkflowTemplateStep>(entity =>
        {
            entity.ToTable("workflow_template_steps");
            entity.HasIndex(x => new { x.VersionId, x.SortOrder });
            entity.Property(x => x.StepNameAr).HasMaxLength(255);
            entity.Property(x => x.StepType).HasMaxLength(80);
            entity.HasOne(x => x.Version).WithMany(x => x.WorkflowSteps).HasForeignKey(x => x.VersionId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.ApproverRole).WithMany().HasForeignKey(x => x.ApproverRoleId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(x => x.ApproverUser).WithMany().HasForeignKey(x => x.ApproverUserId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(x => x.TargetDepartment).WithMany().HasForeignKey(x => x.TargetDepartmentId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(x => x.EscalationUser).WithMany().HasForeignKey(x => x.EscalationUserId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(x => x.EscalationRole).WithMany().HasForeignKey(x => x.EscalationRoleId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<RequestTypeSettings>(entity =>
        {
            entity.ToTable("request_type_settings");
            entity.HasIndex(x => x.VersionId).IsUnique();
            entity.Property(x => x.DefaultPriority).HasMaxLength(50);
            entity.HasOne(x => x.RequestType).WithMany().HasForeignKey(x => x.RequestTypeId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.Version).WithOne(x => x.Settings).HasForeignKey<RequestTypeSettings>(x => x.VersionId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<RequestEntity>(entity =>
        {
            entity.ToTable("requests");
            entity.HasIndex(x => x.RequestNumber).IsUnique();
            entity.HasIndex(x => x.Status);
            entity.HasIndex(x => x.CreatedAt);
            entity.HasIndex(x => x.RequestTypeId);
            entity.HasIndex(x => x.DepartmentId);
            entity.HasIndex(x => x.SpecializedSectionId);
            entity.Property(x => x.RequestNumber).HasMaxLength(50);
            entity.Property(x => x.Title).HasMaxLength(300);
            entity.Property(x => x.Status).HasMaxLength(60);
            entity.Property(x => x.Priority).HasMaxLength(50);
            entity.HasOne(x => x.RequestType).WithMany().HasForeignKey(x => x.RequestTypeId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(x => x.RequestTypeVersion).WithMany().HasForeignKey(x => x.RequestTypeVersionId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(x => x.Requester).WithMany().HasForeignKey(x => x.RequesterId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(x => x.Department).WithMany().HasForeignKey(x => x.DepartmentId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(x => x.SpecializedSection).WithMany().HasForeignKey(x => x.SpecializedSectionId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(x => x.AssignedTo).WithMany().HasForeignKey(x => x.AssignedToId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<RequestFieldSnapshot>(entity =>
        {
            entity.ToTable("request_field_snapshots");
            entity.HasIndex(x => new { x.RequestId, x.FieldName });
            entity.Property(x => x.FieldName).HasMaxLength(100);
            entity.Property(x => x.LabelAr).HasMaxLength(255);
            entity.Property(x => x.FieldType).HasMaxLength(60);
            entity.HasOne(x => x.Request).WithMany(x => x.FieldSnapshots).HasForeignKey(x => x.RequestId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<RequestWorkflowSnapshot>(entity =>
        {
            entity.ToTable("request_workflow_snapshots");
            entity.HasIndex(x => new { x.RequestId, x.SortOrder });
            entity.HasIndex(x => x.Status);
            entity.Property(x => x.StepNameAr).HasMaxLength(255);
            entity.Property(x => x.StepType).HasMaxLength(80);
            entity.Property(x => x.Status).HasMaxLength(60);
            entity.HasOne(x => x.Request).WithMany(x => x.WorkflowSnapshots).HasForeignKey(x => x.RequestId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.ApproverRole).WithMany().HasForeignKey(x => x.ApproverRoleId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(x => x.ApproverUser).WithMany().HasForeignKey(x => x.ApproverUserId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(x => x.TargetDepartment).WithMany().HasForeignKey(x => x.TargetDepartmentId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(x => x.ActionByUser).WithMany().HasForeignKey(x => x.ActionByUserId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<RequestAttachment>(entity =>
        {
            entity.ToTable("request_attachments");
            entity.HasIndex(x => x.RequestId);
            entity.Property(x => x.FileName).HasMaxLength(255);
            entity.Property(x => x.StoredFileName).HasMaxLength(255);
            entity.Property(x => x.ContentType).HasMaxLength(150);
            entity.HasOne(x => x.Request).WithMany(x => x.Attachments).HasForeignKey(x => x.RequestId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.UploadedByUser).WithMany().HasForeignKey(x => x.UploadedByUserId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<RequestStatusHistory>(entity =>
        {
            entity.ToTable("request_status_history");
            entity.HasIndex(x => new { x.RequestId, x.ChangedAt });
            entity.Property(x => x.NewStatus).HasMaxLength(60);
            entity.Property(x => x.OldStatus).HasMaxLength(60);
            entity.HasOne(x => x.Request).WithMany(x => x.StatusHistory).HasForeignKey(x => x.RequestId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.ChangedByUser).WithMany().HasForeignKey(x => x.ChangedByUserId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<RequestComment>(entity =>
        {
            entity.ToTable("request_comments");
            entity.HasIndex(x => x.RequestId);
            entity.Property(x => x.CommentType).HasMaxLength(60);
            entity.HasOne(x => x.Request).WithMany(x => x.Comments).HasForeignKey(x => x.RequestId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.CreatedByUser).WithMany().HasForeignKey(x => x.CreatedByUserId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<RequestExecutionLog>(entity =>
        {
            entity.ToTable("request_execution_logs");
            entity.HasIndex(x => x.RequestId);
            entity.Property(x => x.Status).HasMaxLength(60);
            entity.HasOne(x => x.Request).WithMany(x => x.ExecutionLogs).HasForeignKey(x => x.RequestId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.ExecutedByUser).WithMany().HasForeignKey(x => x.ExecutedByUserId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<RequestSlaTracking>(entity =>
        {
            entity.ToTable("request_sla_tracking");
            entity.HasIndex(x => x.RequestId).IsUnique();
            entity.HasOne(x => x.Request).WithOne(x => x.SlaTracking).HasForeignKey<RequestSlaTracking>(x => x.RequestId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<MessageType>(entity =>
        {
            entity.ToTable("message_types");
            entity.HasIndex(x => x.Code).IsUnique();
            entity.Property(x => x.Code).HasMaxLength(100);
            entity.Property(x => x.NameAr).HasMaxLength(255);
            entity.Property(x => x.Description).HasMaxLength(1000);
            entity.Property(x => x.Color).HasMaxLength(30);
            entity.Property(x => x.Icon).HasMaxLength(80);
        });

        modelBuilder.Entity<MessageClassification>(entity =>
        {
            entity.ToTable("message_classifications");
            entity.HasIndex(x => x.Code).IsUnique();
            entity.Property(x => x.Code).HasMaxLength(100);
            entity.Property(x => x.NameAr).HasMaxLength(255);
            entity.Property(x => x.Description).HasMaxLength(1000);
            entity.Property(x => x.Color).HasMaxLength(30);
        });

        modelBuilder.Entity<MessageTemplate>(entity =>
        {
            entity.ToTable("message_templates");
            entity.HasIndex(x => x.Code).IsUnique();
            entity.Property(x => x.Code).HasMaxLength(100);
            entity.Property(x => x.NameAr).HasMaxLength(255);
            entity.HasOne(x => x.MessageType).WithMany(x => x.Templates).HasForeignKey(x => x.MessageTypeId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<Message>(entity =>
        {
            entity.ToTable("messages");
            entity.HasIndex(x => x.SentAt);
            entity.HasIndex(x => x.RelatedRequestId);
            entity.HasIndex(x => x.MessageTypeId);
            entity.Property(x => x.Subject).HasMaxLength(300);
            entity.Property(x => x.Priority).HasMaxLength(30);
            entity.Property(x => x.OfficialStatus).HasMaxLength(40);
            entity.Property(x => x.OfficialReferenceNumber).HasMaxLength(100);
            entity.HasOne(x => x.Sender).WithMany().HasForeignKey(x => x.SenderId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(x => x.MessageType).WithMany(x => x.Messages).HasForeignKey(x => x.MessageTypeId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(x => x.Classification).WithMany(x => x.Messages).HasForeignKey(x => x.ClassificationId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(x => x.ParentMessage).WithMany().HasForeignKey(x => x.ParentMessageId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(x => x.RelatedRequest).WithMany().HasForeignKey(x => x.RelatedRequestId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<MessageRecipient>(entity =>
        {
            entity.ToTable("message_recipients");
            entity.HasIndex(x => new { x.MessageId, x.RecipientId }).IsUnique();
            entity.HasIndex(x => new { x.RecipientId, x.IsRead, x.IsArchived });
            entity.HasOne(x => x.Message).WithMany(x => x.Recipients).HasForeignKey(x => x.MessageId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.Recipient).WithMany().HasForeignKey(x => x.RecipientId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<MessageAttachment>(entity =>
        {
            entity.ToTable("message_attachments");
            entity.HasIndex(x => x.MessageId);
            entity.Property(x => x.FileName).HasMaxLength(255);
            entity.Property(x => x.StoredFileName).HasMaxLength(255);
            entity.Property(x => x.ContentType).HasMaxLength(150);
            entity.HasOne(x => x.Message).WithMany(x => x.Attachments).HasForeignKey(x => x.MessageId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.UploadedByUser).WithMany().HasForeignKey(x => x.UploadedByUserId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<OfficialLetterheadTemplate>(entity =>
        {
            entity.ToTable("official_letterhead_templates");
            entity.HasIndex(x => x.Code).IsUnique();
            entity.Property(x => x.Code).HasMaxLength(100);
            entity.Property(x => x.NameAr).HasMaxLength(255);
            entity.Property(x => x.PrimaryColor).HasMaxLength(30);
            entity.Property(x => x.SecondaryColor).HasMaxLength(30);
            entity.HasOne(x => x.CreatedByUser).WithMany().HasForeignKey(x => x.CreatedByUserId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<OfficialMessageSettings>(entity =>
        {
            entity.ToTable("official_message_settings");
            entity.HasOne(x => x.DefaultLetterheadTemplate).WithMany().HasForeignKey(x => x.DefaultLetterheadTemplateId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<OfficialMessageDocument>(entity =>
        {
            entity.ToTable("official_message_documents");
            entity.HasIndex(x => x.MessageId);
            entity.HasOne(x => x.Message).WithMany().HasForeignKey(x => x.MessageId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.RelatedRequest).WithMany().HasForeignKey(x => x.RelatedRequestId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(x => x.LetterheadTemplate).WithMany().HasForeignKey(x => x.LetterheadTemplateId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(x => x.Signature).WithMany().HasForeignKey(x => x.SignatureId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(x => x.GeneratedByUser).WithMany().HasForeignKey(x => x.GeneratedByUserId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<DocumentCategory>(entity =>
        {
            entity.ToTable("document_categories");
            entity.HasIndex(x => x.Code).IsUnique();
            entity.Property(x => x.Code).HasMaxLength(100);
            entity.Property(x => x.NameAr).HasMaxLength(255);
            entity.Property(x => x.Color).HasMaxLength(30);
            entity.Property(x => x.Icon).HasMaxLength(80);
        });

        modelBuilder.Entity<Document>(entity =>
        {
            entity.ToTable("documents");
            entity.HasIndex(x => x.CategoryId);
            entity.HasIndex(x => x.DocumentNumber);
            entity.HasIndex(x => x.Classification);
            entity.HasIndex(x => x.Status);
            entity.Property(x => x.TitleAr).HasMaxLength(300);
            entity.Property(x => x.DocumentNumber).HasMaxLength(100);
            entity.Property(x => x.Classification).HasMaxLength(40);
            entity.Property(x => x.Status).HasMaxLength(40);
            entity.HasOne(x => x.Category).WithMany(x => x.Documents).HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Restrict);
            entity.HasOne(x => x.OwnerDepartment).WithMany().HasForeignKey(x => x.OwnerDepartmentId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(x => x.CurrentVersion).WithMany().HasForeignKey(x => x.CurrentVersionId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(x => x.CreatedByUser).WithMany().HasForeignKey(x => x.CreatedByUserId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<DocumentVersion>(entity =>
        {
            entity.ToTable("document_versions");
            entity.HasIndex(x => new { x.DocumentId, x.VersionNumber }).IsUnique();
            entity.Property(x => x.VersionNumber).HasMaxLength(40);
            entity.Property(x => x.FileName).HasMaxLength(255);
            entity.Property(x => x.StoredFileName).HasMaxLength(255);
            entity.Property(x => x.MimeType).HasMaxLength(150);
            entity.HasOne(x => x.Document).WithMany(x => x.Versions).HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.UploadedByUser).WithMany().HasForeignKey(x => x.UploadedByUserId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<DocumentPermission>(entity =>
        {
            entity.ToTable("document_permissions");
            entity.HasIndex(x => x.CategoryId);
            entity.HasIndex(x => x.DocumentId);
            entity.HasOne(x => x.Category).WithMany().HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.Document).WithMany().HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.Role).WithMany().HasForeignKey(x => x.RoleId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.Department).WithMany().HasForeignKey(x => x.DepartmentId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<DocumentAccessLog>(entity =>
        {
            entity.ToTable("document_access_logs");
            entity.HasIndex(x => new { x.DocumentId, x.CreatedAt });
            entity.HasIndex(x => x.Action);
            entity.HasOne(x => x.Document).WithMany().HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.Version).WithMany().HasForeignKey(x => x.VersionId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Restrict);
        });

        modelBuilder.Entity<DocumentAcknowledgement>(entity =>
        {
            entity.ToTable("document_acknowledgements");
            entity.HasIndex(x => new { x.DocumentId, x.VersionId, x.UserId }).IsUnique();
            entity.HasOne(x => x.Document).WithMany(x => x.Acknowledgements).HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.Version).WithMany().HasForeignKey(x => x.VersionId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<UserSession>(entity =>
        {
            entity.ToTable("user_sessions");
            entity.HasIndex(x => x.SessionTokenHash).IsUnique();
            entity.HasIndex(x => new { x.UserId, x.IsActive, x.LastSeenAt });
            entity.Property(x => x.SessionTokenHash).HasMaxLength(255);
            entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<UserLoginAttempt>(entity =>
        {
            entity.ToTable("user_login_attempts");
            entity.HasIndex(x => x.AttemptedAt);
            entity.HasIndex(x => new { x.LoginIdentifier, x.AttemptedAt });
            entity.Property(x => x.LoginIdentifier).HasMaxLength(255);
            entity.Property(x => x.FailureReason).HasMaxLength(500);
            entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<SystemHealthCheck>(entity =>
        {
            entity.ToTable("system_health_checks");
            entity.HasIndex(x => new { x.Category, x.CheckedAt });
            entity.HasIndex(x => x.Status);
            entity.Property(x => x.CheckName).HasMaxLength(120);
            entity.Property(x => x.Category).HasMaxLength(80);
            entity.Property(x => x.Status).HasMaxLength(40);
        });

        modelBuilder.Entity<SystemHealthAlert>(entity =>
        {
            entity.ToTable("system_health_alerts");
            entity.HasIndex(x => new { x.IsResolved, x.Severity, x.CreatedAt });
            entity.Property(x => x.AlertType).HasMaxLength(100);
            entity.Property(x => x.Severity).HasMaxLength(40);
            entity.Property(x => x.Title).HasMaxLength(255);
            entity.Property(x => x.RelatedRoute).HasMaxLength(300);
            entity.HasOne(x => x.ResolvedByUser).WithMany().HasForeignKey(x => x.ResolvedByUserId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<SystemHealthMetric>(entity =>
        {
            entity.ToTable("system_health_metrics");
            entity.HasIndex(x => new { x.Category, x.RecordedAt });
            entity.HasIndex(x => x.MetricName);
            entity.Property(x => x.MetricName).HasMaxLength(120);
            entity.Property(x => x.MetricUnit).HasMaxLength(40);
            entity.Property(x => x.Category).HasMaxLength(80);
        });

        modelBuilder.Entity<SystemHealthSettings>(entity =>
        {
            entity.ToTable("system_health_settings");
        });

        modelBuilder.Entity<DatabaseBackup>(entity =>
        {
            entity.ToTable("database_backups");
            entity.HasIndex(x => new { x.Status, x.StartedAt });
            entity.Property(x => x.BackupName).HasMaxLength(255);
            entity.Property(x => x.BackupType).HasMaxLength(60);
            entity.Property(x => x.Status).HasMaxLength(60);
            entity.HasOne(x => x.CreatedByUser).WithMany().HasForeignKey(x => x.CreatedByUserId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<DatabaseJob>(entity =>
        {
            entity.ToTable("database_jobs");
            entity.HasIndex(x => new { x.Status, x.CreatedAt });
            entity.Property(x => x.JobType).HasMaxLength(80);
            entity.Property(x => x.Status).HasMaxLength(60);
            entity.HasOne(x => x.StartedByUser).WithMany().HasForeignKey(x => x.StartedByUserId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<DatabaseMaintenanceLog>(entity =>
        {
            entity.ToTable("database_maintenance_logs");
            entity.HasIndex(x => new { x.Operation, x.CreatedAt });
            entity.Property(x => x.Operation).HasMaxLength(100);
            entity.Property(x => x.Status).HasMaxLength(60);
            entity.HasOne(x => x.ActorUser).WithMany().HasForeignKey(x => x.ActorUserId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<DatabaseRestoreJob>(entity =>
        {
            entity.ToTable("database_restore_jobs");
            entity.HasIndex(x => x.RestoreToken).IsUnique();
            entity.Property(x => x.RestoreToken).HasMaxLength(120);
            entity.Property(x => x.Status).HasMaxLength(60);
            entity.HasOne(x => x.RequestedByUser).WithMany().HasForeignKey(x => x.RequestedByUserId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<RollbackPoint>(entity =>
        {
            entity.ToTable("rollback_points");
            entity.HasIndex(x => x.CreatedAt);
            entity.Property(x => x.Name).HasMaxLength(255);
            entity.Property(x => x.Version).HasMaxLength(80);
            entity.Property(x => x.Status).HasMaxLength(60);
            entity.HasOne(x => x.CreatedByUser).WithMany().HasForeignKey(x => x.CreatedByUserId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<SystemVersion>(entity =>
        {
            entity.ToTable("system_versions");
            entity.HasIndex(x => x.Version).IsUnique();
            entity.Property(x => x.Version).HasMaxLength(80);
            entity.Property(x => x.BuildNumber).HasMaxLength(100);
            entity.Property(x => x.Status).HasMaxLength(60);
            entity.HasOne(x => x.AppliedByUser).WithMany().HasForeignKey(x => x.AppliedByUserId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<UpdatePackage>(entity =>
        {
            entity.ToTable("update_packages");
            entity.HasIndex(x => new { x.Version, x.PackageName });
            entity.Property(x => x.PackageName).HasMaxLength(255);
            entity.Property(x => x.Version).HasMaxLength(80);
            entity.Property(x => x.Status).HasMaxLength(60);
            entity.HasOne(x => x.UploadedByUser).WithMany().HasForeignKey(x => x.UploadedByUserId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<UpdateJob>(entity =>
        {
            entity.ToTable("update_jobs");
            entity.HasIndex(x => new { x.Status, x.CreatedAt });
            entity.Property(x => x.JobType).HasMaxLength(80);
            entity.Property(x => x.Status).HasMaxLength(60);
            entity.HasOne(x => x.Package).WithMany().HasForeignKey(x => x.PackageId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(x => x.StartedByUser).WithMany().HasForeignKey(x => x.StartedByUserId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<UpdateLog>(entity =>
        {
            entity.ToTable("update_logs");
            entity.HasIndex(x => new { x.UpdateJobId, x.LoggedAt });
            entity.Property(x => x.Level).HasMaxLength(40);
            entity.HasOne(x => x.UpdateJob).WithMany().HasForeignKey(x => x.UpdateJobId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<UpdateHistory>(entity =>
        {
            entity.ToTable("update_history");
            entity.HasIndex(x => x.Version);
            entity.Property(x => x.Version).HasMaxLength(80);
            entity.Property(x => x.Status).HasMaxLength(60);
            entity.HasOne(x => x.AppliedByUser).WithMany().HasForeignKey(x => x.AppliedByUserId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<SavedReport>(entity =>
        {
            entity.ToTable("saved_reports");
            entity.HasIndex(x => new { x.CreatedByUserId, x.ReportType });
            entity.Property(x => x.Name).HasMaxLength(255);
            entity.Property(x => x.ReportType).HasMaxLength(80);
            entity.HasOne(x => x.CreatedByUser).WithMany().HasForeignKey(x => x.CreatedByUserId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ReportTemplate>(entity =>
        {
            entity.ToTable("report_templates");
            entity.HasIndex(x => x.Code).IsUnique();
            entity.Property(x => x.NameAr).HasMaxLength(255);
            entity.Property(x => x.Code).HasMaxLength(120);
            entity.Property(x => x.ReportType).HasMaxLength(80);
            entity.HasOne(x => x.CreatedByUser).WithMany().HasForeignKey(x => x.CreatedByUserId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<ScheduledReport>(entity =>
        {
            entity.ToTable("scheduled_reports");
            entity.HasIndex(x => new { x.IsActive, x.NextRunAt });
            entity.Property(x => x.Name).HasMaxLength(255);
            entity.Property(x => x.Frequency).HasMaxLength(40);
            entity.Property(x => x.ExportFormat).HasMaxLength(40);
            entity.HasOne(x => x.ReportTemplate).WithMany().HasForeignKey(x => x.ReportTemplateId).OnDelete(DeleteBehavior.SetNull);
            entity.HasOne(x => x.CreatedByUser).WithMany().HasForeignKey(x => x.CreatedByUserId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ReportExportLog>(entity =>
        {
            entity.ToTable("report_export_logs");
            entity.HasIndex(x => new { x.ReportType, x.ExportedAt });
            entity.Property(x => x.ReportType).HasMaxLength(80);
            entity.Property(x => x.ExportFormat).HasMaxLength(40);
            entity.HasOne(x => x.ExportedByUser).WithMany().HasForeignKey(x => x.ExportedByUserId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<AiSettings>(entity =>
        {
            entity.ToTable("ai_settings");
            entity.Property(x => x.Provider).HasMaxLength(80);
            entity.Property(x => x.ModelName).HasMaxLength(150);
            entity.HasOne(x => x.UpdatedByUser).WithMany().HasForeignKey(x => x.UpdatedByUserId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<AiUsageLog>(entity =>
        {
            entity.ToTable("ai_usage_logs");
            entity.HasIndex(x => new { x.Feature, x.CreatedAt });
            entity.Property(x => x.Feature).HasMaxLength(100);
            entity.Property(x => x.Status).HasMaxLength(60);
            entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<AiPromptTemplate>(entity =>
        {
            entity.ToTable("ai_prompt_templates");
            entity.HasIndex(x => x.Code).IsUnique();
            entity.Property(x => x.Code).HasMaxLength(120);
            entity.Property(x => x.NameAr).HasMaxLength(255);
            entity.Property(x => x.Feature).HasMaxLength(100);
        });

        modelBuilder.Entity<AiHealthCheck>(entity =>
        {
            entity.ToTable("ai_health_checks");
            entity.HasIndex(x => new { x.Provider, x.CheckedAt });
            entity.Property(x => x.Provider).HasMaxLength(80);
            entity.Property(x => x.Status).HasMaxLength(60);
        });

        modelBuilder.Entity<AiFeaturePermission>(entity =>
        {
            entity.ToTable("ai_feature_permissions");
            entity.HasIndex(x => new { x.Feature, x.RoleId, x.UserId });
            entity.Property(x => x.Feature).HasMaxLength(100);
            entity.HasOne(x => x.Role).WithMany().HasForeignKey(x => x.RoleId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<AiFeedback>(entity =>
        {
            entity.ToTable("ai_feedback");
            entity.HasIndex(x => new { x.Feature, x.CreatedAt });
            entity.Property(x => x.Feature).HasMaxLength(100);
            entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<MessagingSettings>(entity =>
        {
            entity.ToTable("messaging_settings");
            entity.HasOne(x => x.UpdatedByUser).WithMany().HasForeignKey(x => x.UpdatedByUserId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<MessageAttachmentSettings>(entity =>
        {
            entity.ToTable("message_attachment_settings");
        });

        modelBuilder.Entity<MessageNotificationSettings>(entity =>
        {
            entity.ToTable("message_notification_settings");
        });

        modelBuilder.Entity<MessageRequestIntegrationSettings>(entity =>
        {
            entity.ToTable("message_request_integration_settings");
        });

        modelBuilder.Entity<MessageRetentionPolicy>(entity =>
        {
            entity.ToTable("message_retention_policies");
        });

        modelBuilder.Entity<MessageSecurityPolicy>(entity =>
        {
            entity.ToTable("message_security_policies");
        });

        modelBuilder.Entity<MessageAiSettings>(entity =>
        {
            entity.ToTable("message_ai_settings");
        });

        modelBuilder.Entity<MessageAutoRule>(entity =>
        {
            entity.ToTable("message_auto_rules");
            entity.HasIndex(x => x.EventCode).IsUnique();
            entity.Property(x => x.EventCode).HasMaxLength(120);
            entity.Property(x => x.MessageTypeCode).HasMaxLength(120);
            entity.Property(x => x.TemplateCode).HasMaxLength(120);
            entity.Property(x => x.SubjectTemplate).HasDefaultValue("");
            entity.Property(x => x.BodyTemplate).HasDefaultValue("");
            entity.HasOne(x => x.MessageType).WithMany().HasForeignKey(x => x.MessageTypeId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<UserSignature>(entity =>
        {
            entity.ToTable("user_signatures");
            entity.HasIndex(x => new { x.UserId, x.IsActive });
            entity.HasOne(x => x.User).WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.VerifiedByUser).WithMany().HasForeignKey(x => x.VerifiedByUserId).OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<RequestTypeDocument>(entity =>
        {
            entity.ToTable("request_type_documents");
            entity.HasIndex(x => new { x.RequestTypeId, x.DocumentId }).IsUnique();
            entity.HasOne(x => x.RequestType).WithMany().HasForeignKey(x => x.RequestTypeId).OnDelete(DeleteBehavior.Cascade);
            entity.HasOne(x => x.Document).WithMany().HasForeignKey(x => x.DocumentId).OnDelete(DeleteBehavior.Cascade);
        });
    }

    public override Task<int> SaveChangesAsync(CancellationToken cancellationToken = default)
    {
        var now = DateTimeOffset.UtcNow;
        foreach (var entry in ChangeTracker.Entries<BaseEntity>())
        {
            if (entry.State == EntityState.Added)
            {
                entry.Entity.CreatedAt = now;
                entry.Entity.UpdatedAt = now;
            }

            if (entry.State == EntityState.Modified)
            {
                entry.Entity.UpdatedAt = now;
            }
        }

        return base.SaveChangesAsync(cancellationToken);
    }
}
