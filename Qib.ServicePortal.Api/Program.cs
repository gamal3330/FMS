using System.Text;
using FluentValidation;
using FluentValidation.AspNetCore;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Microsoft.OpenApi.Models;
using Qib.ServicePortal.Api.Application.DTOs;
using Qib.ServicePortal.Api.Application.Interfaces;
using Qib.ServicePortal.Api.Application.Services;
using Qib.ServicePortal.Api.Application.Validators;
using Qib.ServicePortal.Api.Common.Authorization;
using Qib.ServicePortal.Api.Common.Middleware;
using Qib.ServicePortal.Api.Common.OpenApi;
using Qib.ServicePortal.Api.Infrastructure.Data;
using Qib.ServicePortal.Api.Infrastructure.Security;
using Quartz;
using Serilog;

var builder = WebApplication.CreateBuilder(args);

builder.Host.UseSerilog((context, _, loggerConfiguration) =>
{
    loggerConfiguration.ReadFrom.Configuration(context.Configuration);
});

builder.Services.AddControllers();
builder.Services.AddFluentValidationAutoValidation();
builder.Services.AddValidatorsFromAssemblyContaining<LoginRequestValidator>();
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen(options =>
{
    options.SwaggerDoc("v1", new OpenApiInfo
    {
        Title = "QIB Service Portal API",
        Version = "v1",
        Description = "OpenAPI documentation for the standalone ASP.NET Core backend. Base route: /api/dotnet/v1.",
        Contact = new OpenApiContact
        {
            Name = "QIB Service Portal"
        }
    });

    options.AddSecurityDefinition("Bearer", new OpenApiSecurityScheme
    {
        Description = "أدخل JWT بهذا الشكل: Bearer {token}",
        Name = "Authorization",
        In = ParameterLocation.Header,
        Type = SecuritySchemeType.Http,
        Scheme = "bearer",
        BearerFormat = "JWT"
    });

    options.OperationFilter<AuthorizeOperationFilter>();
    options.CustomSchemaIds(type => type.FullName?.Replace("+", ".") ?? type.Name);

    var xmlFile = $"{typeof(Program).Assembly.GetName().Name}.xml";
    var xmlPath = Path.Combine(AppContext.BaseDirectory, xmlFile);
    if (File.Exists(xmlPath))
    {
        options.IncludeXmlComments(xmlPath);
    }
});
builder.Services.AddHttpContextAccessor();

var connectionString = DatabaseUrlParser.ResolveConnectionString(builder.Configuration);
builder.Services.AddDbContext<ServicePortalDbContext>(options => options.UseNpgsql(connectionString));

builder.Services.Configure<JwtOptions>(builder.Configuration.GetSection("Jwt"));
var jwtOptions = builder.Configuration.GetSection("Jwt").Get<JwtOptions>() ?? new JwtOptions();
var jwtSecret = jwtOptions.Secret;
if (string.IsNullOrWhiteSpace(jwtSecret) || jwtSecret.Length < 32)
{
    throw new InvalidOperationException("JWT secret must be configured and at least 32 characters long.");
}

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(options =>
    {
        options.RequireHttpsMetadata = !builder.Environment.IsDevelopment();
        options.SaveToken = false;
        options.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidateAudience = true,
            ValidateIssuerSigningKey = true,
            ValidateLifetime = true,
            ValidIssuer = jwtOptions.Issuer,
            ValidAudience = jwtOptions.Audience,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
            ClockSkew = TimeSpan.FromMinutes(1)
        };
        options.Events = new JwtBearerEvents
        {
            OnMessageReceived = context =>
            {
                if (context.HttpContext.Request.Path.StartsWithSegments("/api/dotnet/v1/ws/notifications") &&
                    context.Request.Query.TryGetValue("token", out var token))
                {
                    context.Token = token;
                }

                return Task.CompletedTask;
            },
            OnTokenValidated = async context =>
            {
                var sessionTokenHash = context.Principal?.FindFirst("sid")?.Value;
                if (string.IsNullOrWhiteSpace(sessionTokenHash))
                {
                    return;
                }

                var userIdValue = context.Principal?.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
                if (!long.TryParse(userIdValue, out var userId))
                {
                    context.Fail("Invalid user session.");
                    return;
                }

                var db = context.HttpContext.RequestServices.GetRequiredService<ServicePortalDbContext>();
                var now = DateTimeOffset.UtcNow;
                var session = await db.UserSessions.FirstOrDefaultAsync(x =>
                    x.UserId == userId &&
                    x.SessionTokenHash == sessionTokenHash &&
                    x.IsActive &&
                    x.RevokedAt == null &&
                    (x.ExpiresAt == null || x.ExpiresAt > now),
                    context.HttpContext.RequestAborted);

                if (session is null)
                {
                    context.Fail("Session has been revoked.");
                    return;
                }

                session.LastSeenAt = now;
                await db.SaveChangesAsync(context.HttpContext.RequestAborted);
            }
        };
    });

builder.Services.AddAuthorization();
builder.Services.AddSingleton<IAuthorizationPolicyProvider, PermissionPolicyProvider>();
builder.Services.AddSingleton<IAuthorizationHandler, PermissionAuthorizationHandler>();

builder.Services.AddScoped<IPasswordHasher, PasswordHasher>();
builder.Services.AddScoped<IJwtTokenService, JwtTokenService>();
builder.Services.AddScoped<ICurrentUserService, CurrentUserService>();
builder.Services.AddScoped<IAuditService, AuditService>();
builder.Services.AddScoped<IPermissionService, PermissionService>();
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<ISettingsStore, SystemSettingsStore>();
builder.Services.AddSingleton<INotificationRealtimeService, NotificationRealtimeService>();

builder.Services.AddHealthChecks().AddDbContextCheck<ServicePortalDbContext>("database");

builder.Services.AddCors(options =>
{
    options.AddPolicy("ConfiguredCors", policy =>
    {
        var origins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? [];
        if (origins.Length == 0)
        {
            policy.AllowAnyOrigin();
        }
        else
        {
            policy.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod();
        }
    });
});

builder.Services.AddQuartz();
builder.Services.AddQuartzHostedService(options => options.WaitForJobsToComplete = true);

var app = builder.Build();

app.UseSerilogRequestLogging();
app.UseMiddleware<ExceptionHandlingMiddleware>();

if (app.Environment.IsDevelopment() || app.Configuration.GetValue<bool>("Swagger:Enabled"))
{
    app.UseSwagger();
    app.UseSwaggerUI(options =>
    {
        options.RoutePrefix = "api/dotnet/v1/docs";
        options.SwaggerEndpoint("/swagger/v1/swagger.json", "QIB Service Portal API v1");
        options.DocumentTitle = "QIB Service Portal API Docs";
        options.DisplayRequestDuration();
        options.EnableDeepLinking();
        options.DefaultModelsExpandDepth(1);
    });

    app.MapGet("/api/dotnet/v1/openapi.json", () => Results.Redirect("/swagger/v1/swagger.json")).AllowAnonymous();
    app.MapGet("/api/dotnet/v1/swagger", () => Results.Redirect("/api/dotnet/v1/docs")).AllowAnonymous();
}

app.UseCors("ConfiguredCors");
app.UseWebSockets();
app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapHealthChecks("/api/dotnet/v1/health/live").AllowAnonymous();

await using (var scope = app.Services.CreateAsyncScope())
{
    var logger = scope.ServiceProvider.GetRequiredService<ILogger<Program>>();
    var db = scope.ServiceProvider.GetRequiredService<ServicePortalDbContext>();
    var passwordHasher = scope.ServiceProvider.GetRequiredService<IPasswordHasher>();
    var configuration = scope.ServiceProvider.GetRequiredService<IConfiguration>();

    logger.LogInformation("ASP.NET backend startup: preparing standalone database");
    var pendingMigrations = await db.Database.GetPendingMigrationsAsync();
    if (configuration.GetValue<bool>("ApplyMigrationsOnStartup") && pendingMigrations.Any())
    {
        await db.Database.MigrateAsync();
    }
    else
    {
        await db.Database.EnsureCreatedAsync();
    }

    await RuntimeSchema.EnsureAsync(db, logger);
    await SeedData.SeedAsync(db, passwordHasher, configuration);
    logger.LogInformation("ASP.NET backend startup: ready");
}

app.Run();
