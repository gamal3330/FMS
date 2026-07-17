using System.Text.Json;
using Qib.ServicePortal.Api.Application.Services;
using Xunit;

namespace Qib.ServicePortal.Api.Tests;

public class WorkflowConditionEvaluatorTests
{
    [Fact]
    public void AlwaysMode_IsApplicableWithoutCondition()
    {
        var result = WorkflowConditionEvaluator.Evaluate("always", null, FormData("{}"));

        Assert.True(result.IsApplicable);
    }

    [Theory]
    [InlineData("finance", true)]
    [InlineData("human_resources", false)]
    public void ConditionalEquals_EvaluatesSubmittedField(string value, bool expected)
    {
        var condition = """{"field_name":"department_code","operator":"equals","value":"finance"}""";
        var result = WorkflowConditionEvaluator.Evaluate(
            "conditional",
            condition,
            FormData($$"""{"department_code":"{{value}}"}"""));

        Assert.Equal(expected, result.IsApplicable);
    }

    [Theory]
    [InlineData("{}", "empty", true)]
    [InlineData("{}", "not_empty", false)]
    [InlineData("{\"manager_note\":\"ready\"}", "not_empty", true)]
    public void EmptyOperators_HandleMissingAndPresentValues(string json, string operation, bool expected)
    {
        var condition = $$"""{"field_name":"manager_note","operator":"{{operation}}"}""";
        var result = WorkflowConditionEvaluator.Evaluate("conditional", condition, FormData(json));

        Assert.Equal(expected, result.IsApplicable);
    }

    [Fact]
    public void Validation_RejectsConditionWithoutReferencedField()
    {
        var valid = WorkflowConditionEvaluator.TryValidate(
            """{"operator":"equals","value":"yes"}""",
            out var error);

        Assert.False(valid);
        Assert.NotNull(error);
    }

    private static IReadOnlyDictionary<string, JsonElement> FormData(string json)
    {
        return JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json)
               ?? new Dictionary<string, JsonElement>();
    }
}
