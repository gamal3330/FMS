using Microsoft.EntityFrameworkCore;
using Qib.ServicePortal.Api.Domain.Entities;
using Qib.ServicePortal.Api.Infrastructure.Security;

namespace Qib.ServicePortal.Api.Infrastructure.Data;

public static class SeedData
{
    private static readonly (string Code, string NameAr, string Module)[] DefaultPermissions =
    [
        ("users.view", "عرض المستخدمين", "users"),
        ("users.manage", "إدارة المستخدمين", "users"),
        ("roles.view", "عرض الأدوار", "roles"),
        ("roles.manage", "إدارة الأدوار", "roles"),
        ("permissions.view", "عرض الصلاحيات", "permissions"),
        ("permissions.manage", "إدارة الصلاحيات", "permissions"),
        ("departments.view", "عرض الإدارات", "departments"),
        ("departments.manage", "إدارة الإدارات", "departments"),
        ("audit.view", "عرض سجل التدقيق", "audit"),
        ("settings.view", "عرض الإعدادات", "settings"),
        ("settings.manage", "إدارة الإعدادات", "settings"),
        ("dashboard.view", "عرض الإحصائيات", "dashboard"),
        ("health.view", "عرض صحة النظام", "health"),
        ("health.run", "تشغيل فحوصات الصحة", "health"),
        ("request_types.view", "عرض إدارة أنواع الطلبات", "request_management"),
        ("request_types.manage", "إدارة أنواع الطلبات", "request_management"),
        ("request_fields.manage", "إدارة حقول الطلبات", "request_management"),
        ("request_workflows.manage", "إدارة مسارات الموافقات", "request_management"),
        ("requests.view", "عرض الطلبات", "requests"),
        ("requests.manage", "إدارة الطلبات", "requests"),
        ("approvals.view", "عرض الموافقات", "approvals"),
        ("messages.view", "عرض المراسلات", "messages"),
        ("messages.send", "إرسال المراسلات", "messages"),
        ("messages.manage", "إدارة المراسلات", "messages"),
        ("official_messages.preview", "معاينة الخطاب الرسمي", "messages"),
        ("official_messages.generate", "توليد الخطاب الرسمي", "messages"),
        ("official_messages.download", "تحميل الخطاب الرسمي", "messages"),
        ("official_letterheads.manage", "إدارة قوالب الترويسة الرسمية", "settings"),
        ("signatures.manage", "إدارة تواقيع المستخدمين", "settings"),
        ("documents.view", "عرض الوثائق", "documents"),
        ("documents.manage", "إدارة الوثائق", "documents"),
        ("documents.download", "تحميل الوثائق", "documents"),
        ("documents.print", "طباعة الوثائق", "documents"),
        ("documents.acknowledge", "الإقرار بالاطلاع على الوثائق", "documents"),
        ("documents.versions.view", "عرض إصدارات الوثائق", "documents"),
        ("documents.logs.view", "عرض سجل الوصول للوثائق", "documents"),
        ("reports.view", "عرض التقارير", "reports")
    ];

    public static async Task SeedAsync(ServicePortalDbContext db, IPasswordHasher passwordHasher, IConfiguration configuration)
    {
        foreach (var item in DefaultPermissions)
        {
            if (!await db.Permissions.AnyAsync(x => x.Code == item.Code))
            {
                db.Permissions.Add(new Permission
                {
                    Code = item.Code,
                    NameAr = item.NameAr,
                    NameEn = item.Code,
                    Module = item.Module,
                    IsActive = true
                });
            }
        }

        await db.SaveChangesAsync();

        var superAdminRole = await db.Roles.FirstOrDefaultAsync(x => x.Code == "super_admin");
        if (superAdminRole is null)
        {
            superAdminRole = new Role
            {
                Code = "super_admin",
                NameAr = "مدير النظام",
                NameEn = "Super Admin",
                IsSystem = true,
                IsActive = true
            };
            db.Roles.Add(superAdminRole);
            await db.SaveChangesAsync();
        }

        var employeeRole = await db.Roles.FirstOrDefaultAsync(x => x.Code == "employee");
        if (employeeRole is null)
        {
            employeeRole = new Role
            {
                Code = "employee",
                NameAr = "موظف",
                NameEn = "Employee",
                IsSystem = true,
                IsActive = true
            };
            db.Roles.Add(employeeRole);
            await db.SaveChangesAsync();
        }

        var bankRoles = new[]
        {
            new Role { Code = "direct_manager", NameAr = "مدير مباشر", NameEn = "Direct Manager", IsSystem = true, IsActive = true },
            new Role { Code = "it_staff", NameAr = "مختص تنفيذ", NameEn = "Execution Specialist", IsSystem = true, IsActive = true },
            new Role { Code = "administration_manager", NameAr = "مدير إدارة", NameEn = "Department Manager", IsSystem = true, IsActive = true },
            new Role { Code = "executive_management", NameAr = "الإدارة التنفيذية", NameEn = "Executive Management", IsSystem = true, IsActive = true }
        };

        foreach (var role in bankRoles)
        {
            var existing = await db.Roles.FirstOrDefaultAsync(x => x.Code == role.Code);
            if (existing is null)
            {
                db.Roles.Add(role);
            }
            else
            {
                existing.NameAr = role.NameAr;
                existing.NameEn = role.NameEn;
                existing.IsSystem = true;
                existing.IsActive = true;
            }
        }

        await db.SaveChangesAsync();

        var permissions = await db.Permissions.Where(x => x.IsActive).ToListAsync();
        foreach (var permission in permissions)
        {
            if (!await db.RolePermissions.AnyAsync(x => x.RoleId == superAdminRole.Id && x.PermissionId == permission.Id))
            {
                db.RolePermissions.Add(new RolePermission
                {
                    RoleId = superAdminRole.Id,
                    PermissionId = permission.Id,
                    IsAllowed = true
                });
            }
        }

        var employeeDefaultCodes = new[] { "requests.view", "approvals.view", "messages.view", "messages.send", "official_messages.preview", "documents.view", "documents.acknowledge" };
        foreach (var permission in permissions.Where(x => employeeDefaultCodes.Contains(x.Code)))
        {
            if (!await db.RolePermissions.AnyAsync(x => x.RoleId == employeeRole.Id && x.PermissionId == permission.Id))
            {
                db.RolePermissions.Add(new RolePermission
                {
                    RoleId = employeeRole.Id,
                    PermissionId = permission.Id,
                    IsAllowed = true
                });
            }
        }

        var roleDefaultPermissions = new Dictionary<string, string[]>
        {
            ["direct_manager"] = ["requests.view", "approvals.view", "messages.view", "messages.send", "documents.view", "documents.acknowledge", "reports.view"],
            ["it_staff"] = ["requests.view", "requests.manage", "approvals.view", "messages.view", "messages.send", "documents.view", "documents.acknowledge", "reports.view"],
            ["administration_manager"] = ["requests.view", "approvals.view", "messages.view", "messages.send", "documents.view", "documents.acknowledge", "reports.view"],
            ["executive_management"] = ["requests.view", "approvals.view", "messages.view", "messages.send", "documents.view", "documents.acknowledge", "reports.view"]
        };

        foreach (var entry in roleDefaultPermissions)
        {
            var role = await db.Roles.FirstAsync(x => x.Code == entry.Key);
            foreach (var permission in permissions.Where(x => entry.Value.Contains(x.Code)))
            {
                if (!await db.RolePermissions.AnyAsync(x => x.RoleId == role.Id && x.PermissionId == permission.Id))
                {
                    db.RolePermissions.Add(new RolePermission
                    {
                        RoleId = role.Id,
                        PermissionId = permission.Id,
                        IsAllowed = true
                    });
                }
            }
        }

        var defaultDepartment = await EnsureDefaultDepartmentAsync(db);
        await MergeLegacyInformationTechnologyDepartmentAsync(db, defaultDepartment);

        var generalItSection = await db.SpecializedSections.FirstOrDefaultAsync(x => x.Code == "general_it");
        if (generalItSection is null)
        {
            db.SpecializedSections.Add(new SpecializedSection
            {
                Code = "general_it",
                NameAr = "تقنية المعلومات",
                NameEn = "Information Technology",
                DepartmentId = defaultDepartment.Id,
                AllowManualAssignment = true,
                AutoAssignStrategy = "none",
                IsActive = true
            });
        }
        else if (generalItSection.DepartmentId != defaultDepartment.Id)
        {
            generalItSection.DepartmentId = defaultDepartment.Id;
        }

        var priorities = new[]
        {
            new PrioritySetting { Code = "low", NameAr = "منخفضة", NameEn = "Low", Color = "#64748b", ResponseHours = 24, ResolutionHours = 120, SortOrder = 10 },
            new PrioritySetting { Code = "normal", NameAr = "عادية", NameEn = "Normal", Color = "#16a34a", ResponseHours = 8, ResolutionHours = 72, SortOrder = 20 },
            new PrioritySetting { Code = "high", NameAr = "مرتفعة", NameEn = "High", Color = "#f59e0b", ResponseHours = 4, ResolutionHours = 48, SortOrder = 30 },
            new PrioritySetting { Code = "urgent", NameAr = "عاجلة", NameEn = "Urgent", Color = "#ef4444", ResponseHours = 2, ResolutionHours = 24, SortOrder = 40 },
            new PrioritySetting { Code = "critical", NameAr = "حرجة", NameEn = "Critical", Color = "#b91c1c", ResponseHours = 1, ResolutionHours = 8, SortOrder = 50 }
        };

        foreach (var priority in priorities)
        {
            if (!await db.PrioritySettings.AnyAsync(x => x.Code == priority.Code))
            {
                db.PrioritySettings.Add(priority);
            }
        }

        await SeedMessagingAsync(db);
        await SeedOfficialCorrespondenceAsync(db);
        await SeedDocumentCategoriesAsync(db);
        await SeedOperationalTablesAsync(db);

        var adminEmail = configuration["SeedAdmin:Email"] ?? "admin@qib.internal-bank.qa";
        var adminUsername = configuration["SeedAdmin:Username"] ?? "admin";
        var adminPassword = configuration["SeedAdmin:Password"] ?? "ChangeMe@12345";
        if (!await db.Users.AnyAsync(x => x.Email == adminEmail || x.Username == adminUsername))
        {
            db.Users.Add(new User
            {
                Username = adminUsername,
                Email = adminEmail,
                EmployeeNumber = "ADM-001",
                NameAr = "مدير النظام",
                NameEn = "System Administrator",
                DepartmentId = defaultDepartment.Id,
                RoleId = superAdminRole.Id,
                PasswordHash = passwordHasher.Hash(adminPassword),
                IsActive = true,
                ForcePasswordChange = true,
                PasswordChangedAt = DateTimeOffset.UtcNow
            });
        }

        await db.SaveChangesAsync();
    }

    private static async Task<Department> EnsureDefaultDepartmentAsync(ServicePortalDbContext db)
    {
        var defaultDepartment = await db.Departments.FirstOrDefaultAsync(x => x.Code == "IT");
        if (defaultDepartment is not null)
        {
            defaultDepartment.NameAr = "تقنية المعلومات";
            defaultDepartment.NameEn = "Information Technology";
            defaultDepartment.IsActive = true;
            await db.SaveChangesAsync();
            return defaultDepartment;
        }

        var legacyDepartment = await db.Departments.FirstOrDefaultAsync(x => x.Code == "information_technology");
        if (legacyDepartment is not null)
        {
            legacyDepartment.Code = "IT";
            legacyDepartment.NameAr = "تقنية المعلومات";
            legacyDepartment.NameEn = "Information Technology";
            legacyDepartment.IsActive = true;
            await db.SaveChangesAsync();
            return legacyDepartment;
        }

        defaultDepartment = new Department
        {
            Code = "IT",
            NameAr = "تقنية المعلومات",
            NameEn = "Information Technology",
            IsActive = true
        };
        db.Departments.Add(defaultDepartment);
        await db.SaveChangesAsync();
        return defaultDepartment;
    }

    private static async Task MergeLegacyInformationTechnologyDepartmentAsync(ServicePortalDbContext db, Department defaultDepartment)
    {
        var legacyDepartment = await db.Departments.FirstOrDefaultAsync(x => x.Code == "information_technology");
        if (legacyDepartment is null || legacyDepartment.Id == defaultDepartment.Id)
        {
            return;
        }

        if (defaultDepartment.ManagerUserId is null && legacyDepartment.ManagerUserId.HasValue)
        {
            defaultDepartment.ManagerUserId = legacyDepartment.ManagerUserId;
        }

        await db.Users
            .Where(x => x.DepartmentId == legacyDepartment.Id)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.DepartmentId, defaultDepartment.Id));

        await db.Departments
            .Where(x => x.ParentDepartmentId == legacyDepartment.Id)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.ParentDepartmentId, defaultDepartment.Id));

        await db.SpecializedSections
            .Where(x => x.DepartmentId == legacyDepartment.Id)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.DepartmentId, defaultDepartment.Id));

        await db.Requests
            .Where(x => x.DepartmentId == legacyDepartment.Id)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.DepartmentId, defaultDepartment.Id));

        await db.Documents
            .Where(x => x.OwnerDepartmentId == legacyDepartment.Id)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.OwnerDepartmentId, defaultDepartment.Id));

        await db.WorkflowTemplateSteps
            .Where(x => x.TargetDepartmentId == legacyDepartment.Id)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.TargetDepartmentId, defaultDepartment.Id));

        await db.RequestWorkflowSnapshots
            .Where(x => x.TargetDepartmentId == legacyDepartment.Id)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.TargetDepartmentId, defaultDepartment.Id));

        await db.DocumentPermissions
            .Where(x => x.DepartmentId == legacyDepartment.Id)
            .ExecuteUpdateAsync(setters => setters.SetProperty(x => x.DepartmentId, defaultDepartment.Id));

        db.Departments.Remove(legacyDepartment);
        await db.SaveChangesAsync();
    }

    private static async Task SeedMessagingAsync(ServicePortalDbContext db)
    {
        var messageTypes = new[]
        {
            new MessageType { Code = "internal_message", NameAr = "مراسلة داخلية", NameEn = "Internal Message", Color = "#2563eb", Icon = "mail", SortOrder = 10, AllowReply = true },
            new MessageType { Code = "official_message", NameAr = "مراسلة رسمية", NameEn = "Official Message", Color = "#1d4ed8", Icon = "badge-check", IsOfficial = true, ShowInPdf = true, SortOrder = 20, AllowReply = true },
            new MessageType { Code = "clarification_request", NameAr = "طلب استيضاح", NameEn = "Clarification Request", Color = "#f59e0b", Icon = "help-circle", RequiresRequest = true, SortOrder = 30, AllowReply = true },
            new MessageType { Code = "clarification_reply", NameAr = "رد على استيضاح", NameEn = "Clarification Reply", Color = "#16a34a", Icon = "reply", RequiresRequest = true, SortOrder = 40, AllowReply = true },
            new MessageType { Code = "approval_note", NameAr = "ملاحظة موافقة", NameEn = "Approval Note", Color = "#22c55e", Icon = "check", RequiresRequest = true, SortOrder = 50, AllowReply = true },
            new MessageType { Code = "rejection_reason", NameAr = "سبب رفض", NameEn = "Rejection Reason", Color = "#ef4444", Icon = "x-circle", RequiresRequest = true, SortOrder = 60, AllowReply = true },
            new MessageType { Code = "execution_note", NameAr = "ملاحظة تنفيذ", NameEn = "Execution Note", Color = "#0f766e", Icon = "clipboard-check", RequiresRequest = true, SortOrder = 70, AllowReply = true },
            new MessageType { Code = "notification", NameAr = "إشعار", NameEn = "Notification", Color = "#64748b", Icon = "bell", SortOrder = 80, AllowReply = false },
            new MessageType { Code = "broadcast", NameAr = "تعميم", NameEn = "Broadcast", Color = "#7c3aed", Icon = "megaphone", SortOrder = 90, AllowReply = false }
        };

        foreach (var item in messageTypes)
        {
            if (!await db.MessageTypes.AnyAsync(x => x.Code == item.Code))
            {
                db.MessageTypes.Add(item);
            }
        }

        var classifications = new[]
        {
            new MessageClassification { Code = "public", NameAr = "عام", NameEn = "Public", Color = "#16a34a", ShowInPdf = true, ShowInReports = true, AllowAttachmentDownload = true, SortOrder = 10 },
            new MessageClassification { Code = "internal", NameAr = "داخلي", NameEn = "Internal", Color = "#2563eb", ShowInPdf = false, ShowInReports = true, AllowAttachmentDownload = true, SortOrder = 20 },
            new MessageClassification { Code = "confidential", NameAr = "سري", NameEn = "Confidential", Color = "#dc2626", IsConfidential = true, RequiresPermission = true, RequiresSpecialPermission = true, ShowInPdf = false, ShowInReports = true, AllowAttachmentDownload = true, LogDownloads = true, SortOrder = 30 },
            new MessageClassification { Code = "top_secret", NameAr = "سري للغاية", NameEn = "Top Secret", Color = "#7f1d1d", IsConfidential = true, RequiresPermission = true, RequiresSpecialPermission = true, ShowInPdf = false, ShowInReports = false, AllowAttachmentDownload = false, LogDownloads = true, SortOrder = 40 }
        };

        foreach (var item in classifications)
        {
            if (!await db.MessageClassifications.AnyAsync(x => x.Code == item.Code))
            {
                db.MessageClassifications.Add(item);
            }
        }

        await db.SaveChangesAsync();

        var clarificationTypeId = await db.MessageTypes
            .Where(x => x.Code == "clarification_request")
            .Select(x => (long?)x.Id)
            .FirstOrDefaultAsync();
        if (clarificationTypeId.HasValue && !await db.MessageTemplates.AnyAsync(x => x.Code == "missing_information"))
        {
            db.MessageTemplates.Add(new MessageTemplate
            {
                Code = "missing_information",
                NameAr = "طلب معلومات ناقصة",
                NameEn = "Missing Information",
                MessageTypeId = clarificationTypeId.Value,
                SubjectTemplate = "طلب استيضاح بخصوص {{request_number}}",
                BodyTemplate = "السلام عليكم،\nيرجى تزويدنا بالمعلومات الناقصة لاستكمال معالجة الطلب.\nمع الشكر.",
                SortOrder = 10
            });
        }
    }

    private static async Task SeedOperationalTablesAsync(ServicePortalDbContext db)
    {
        if (!await db.SystemHealthSettings.AnyAsync())
        {
            db.SystemHealthSettings.Add(new SystemHealthSettings());
        }

        if (!await db.MessagingSettings.AnyAsync())
        {
            db.MessagingSettings.Add(new MessagingSettings());
        }

        if (!await db.MessageAttachmentSettings.AnyAsync())
        {
            db.MessageAttachmentSettings.Add(new MessageAttachmentSettings());
        }

        if (!await db.MessageNotificationSettings.AnyAsync())
        {
            db.MessageNotificationSettings.Add(new MessageNotificationSettings());
        }

        if (!await db.MessageRequestIntegrationSettings.AnyAsync())
        {
            db.MessageRequestIntegrationSettings.Add(new MessageRequestIntegrationSettings());
        }

        if (!await db.MessageRetentionPolicies.AnyAsync())
        {
            db.MessageRetentionPolicies.Add(new MessageRetentionPolicy());
        }

        if (!await db.MessageSecurityPolicies.AnyAsync())
        {
            db.MessageSecurityPolicies.Add(new MessageSecurityPolicy());
        }

        if (!await db.MessageAiSettings.AnyAsync())
        {
            db.MessageAiSettings.Add(new MessageAiSettings());
        }

        if (!await db.AiSettings.AnyAsync())
        {
            db.AiSettings.Add(new AiSettings
            {
                IsEnabled = false,
                Provider = "ollama",
                BaseUrl = "http://ollama:11434",
                ModelName = "llama3.1",
                MaxInputChars = 5000,
                SystemPrompt = "أنت مساعد داخلي يساعد في صياغة المراسلات والطلبات داخل بنك القطيبي الإسلامي."
            });
        }

        var autoRules = new[]
        {
            new MessageAutoRule { EventCode = "request_created", MessageTypeCode = "notification", TemplateCode = "request_created", IsEnabled = true },
            new MessageAutoRule { EventCode = "request_returned", MessageTypeCode = "notification", TemplateCode = "request_returned", IsEnabled = true },
            new MessageAutoRule { EventCode = "request_completed", MessageTypeCode = "notification", TemplateCode = "request_completed", IsEnabled = true }
        };

        foreach (var rule in autoRules)
        {
            if (!await db.MessageAutoRules.AnyAsync(x => x.EventCode == rule.EventCode))
            {
                db.MessageAutoRules.Add(rule);
            }
        }

        var aiPrompts = new[]
        {
            new AiPromptTemplate { Code = "improve_message", NameAr = "تحسين الصياغة", Feature = "messaging", PromptText = "حسن صياغة النص التالي بأسلوب مهني واضح دون تغيير المعنى." },
            new AiPromptTemplate { Code = "formalize_message", NameAr = "جعلها رسمية", Feature = "messaging", PromptText = "حوّل النص التالي إلى خطاب رسمي مناسب للعمل المصرفي." },
            new AiPromptTemplate { Code = "summarize_text", NameAr = "اختصار النص", Feature = "messaging", PromptText = "اختصر النص التالي مع الحفاظ على النقاط المهمة." }
        };

        foreach (var prompt in aiPrompts)
        {
            if (!await db.AiPromptTemplates.AnyAsync(x => x.Code == prompt.Code))
            {
                db.AiPromptTemplates.Add(prompt);
            }
        }

        var reportTemplates = new[]
        {
            new ReportTemplate { Code = "monthly_requests", NameAr = "تقرير الطلبات الشهري", ReportType = "requests", Description = "ملخص شهري للطلبات حسب الحالة والنوع.", DefaultFiltersJson = "{\"range\":\"this_month\"}", DefaultColumnsJson = "[\"request_number\",\"request_type\",\"status\",\"created_at\"]" },
            new ReportTemplate { Code = "sla_breaches", NameAr = "تقرير الطلبات المتأخرة", ReportType = "sla", Description = "قائمة الطلبات التي تجاوزت اتفاقية مستوى الخدمة.", DefaultFiltersJson = "{\"sla_status\":\"breached\"}", DefaultColumnsJson = "[\"request_number\",\"request_type\",\"sla_status\",\"due_at\"]" },
            new ReportTemplate { Code = "approval_performance", NameAr = "تقرير الموافقات", ReportType = "approvals", Description = "متابعة زمن الموافقات والاختناقات.", DefaultFiltersJson = "{}", DefaultColumnsJson = "[\"request_number\",\"step\",\"approver\",\"status\"]" }
        };

        foreach (var template in reportTemplates)
        {
            if (!await db.ReportTemplates.AnyAsync(x => x.Code == template.Code))
            {
                db.ReportTemplates.Add(template);
            }
        }

        if (!await db.SystemVersions.AnyAsync())
        {
            db.SystemVersions.Add(new SystemVersion
            {
                Version = "dotnet-standalone",
                BuildNumber = typeof(SeedData).Assembly.GetName().Version?.ToString(),
                Status = "active",
                AppliedAt = DateTimeOffset.UtcNow,
                Notes = "Standalone ASP.NET Core backend runtime schema initialized."
            });
        }
    }

    private static async Task SeedOfficialCorrespondenceAsync(ServicePortalDbContext db)
    {
        var template = await db.OfficialLetterheadTemplates.FirstOrDefaultAsync(x => x.Code == "default_bank_letterhead");
        if (template is null)
        {
            template = new OfficialLetterheadTemplate
            {
                Code = "default_bank_letterhead",
                NameAr = "الترويسة الرسمية الافتراضية",
                NameEn = "Default Bank Letterhead",
                HeaderHtml = "بنك القطيبي الإسلامي<br/>Al-Qutaibi Islamic Bank",
                FooterHtml = "QIB Service Portal",
                PrimaryColor = "#0f5132",
                SecondaryColor = "#9bd84e",
                ShowPageNumber = true,
                ShowConfidentialityLabel = true,
                IsDefault = true,
                IsActive = true
            };
            db.OfficialLetterheadTemplates.Add(template);
            await db.SaveChangesAsync();
        }

        if (!await db.OfficialMessageSettings.AnyAsync())
        {
            db.OfficialMessageSettings.Add(new OfficialMessageSettings
            {
                IsEnabled = true,
                DefaultLetterheadTemplateId = template.Id,
                OfficialMessageRequiresApproval = false,
                IncludeOfficialMessagesInRequestPdf = true,
                AllowPreviewForAllUsers = true,
                AllowUnverifiedSignature = false,
                AllowSignatureUploadByUser = true,
                UpdatedAt = DateTimeOffset.UtcNow
            });
        }
        else
        {
            var settings = await db.OfficialMessageSettings.FirstAsync();
            if (settings.DefaultLetterheadTemplateId is null)
            {
                settings.DefaultLetterheadTemplateId = template.Id;
                settings.UpdatedAt = DateTimeOffset.UtcNow;
            }
        }
    }

    private static async Task SeedDocumentCategoriesAsync(ServicePortalDbContext db)
    {
        var categories = new[]
        {
            new DocumentCategory { Code = "decisions", NameAr = "القرارات", NameEn = "Decisions", Icon = "badge-check", Color = "#0f766e", SortOrder = 10 },
            new DocumentCategory { Code = "circulars", NameAr = "التعاميم", NameEn = "Circulars", Icon = "megaphone", Color = "#1d4ed8", SortOrder = 20 },
            new DocumentCategory { Code = "announcements", NameAr = "بلاغات", NameEn = "Announcements", Icon = "bell", Color = "#7c3aed", SortOrder = 30 },
            new DocumentCategory { Code = "forms", NameAr = "النماذج", NameEn = "Forms", Icon = "file-text", Color = "#16a34a", SortOrder = 40 },
            new DocumentCategory { Code = "bank_services", NameAr = "خدمات البنك", NameEn = "Bank Services", Icon = "landmark", Color = "#0891b2", SortOrder = 50 },
            new DocumentCategory { Code = "organization_chart", NameAr = "الهيكل التنظيمي", NameEn = "Organization Chart", Icon = "network", Color = "#475569", SortOrder = 60 },
            new DocumentCategory { Code = "digital_plans", NameAr = "الخطط الرقمية", NameEn = "Digital Plans", Icon = "monitor", Color = "#2563eb", SortOrder = 70 },
            new DocumentCategory { Code = "operational_plans", NameAr = "الخطط التشغيلية", NameEn = "Operational Plans", Icon = "clipboard-list", Color = "#0f766e", SortOrder = 80 },
            new DocumentCategory { Code = "external_documents", NameAr = "الوثائق الخارجية", NameEn = "External Documents", Icon = "external-link", Color = "#64748b", SortOrder = 90 },
            new DocumentCategory { Code = "policies", NameAr = "السياسات", NameEn = "Policies", Icon = "shield", Color = "#0f5132", SortOrder = 100 },
            new DocumentCategory { Code = "instructions", NameAr = "التعليمات", NameEn = "Instructions", Icon = "list-checks", Color = "#ca8a04", SortOrder = 110 },
            new DocumentCategory { Code = "procedures", NameAr = "الإجراءات", NameEn = "Procedures", Icon = "workflow", Color = "#7c2d12", SortOrder = 120 },
            new DocumentCategory { Code = "sharia_fatwas", NameAr = "فتاوى الهيئة الشرعية", NameEn = "Sharia Committee Fatwas", Icon = "scroll-text", Color = "#15803d", SortOrder = 130 },
            new DocumentCategory { Code = "job_descriptions", NameAr = "الوصف الوظيفي", NameEn = "Job Descriptions", Icon = "id-card", Color = "#334155", SortOrder = 140 }
        };

        foreach (var category in categories)
        {
            if (!await db.DocumentCategories.AnyAsync(x => x.Code == category.Code))
            {
                db.DocumentCategories.Add(category);
            }
        }
    }
}
