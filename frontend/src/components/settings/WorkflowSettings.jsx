import { useEffect, useState } from "react";
import { api, getErrorMessage } from "../../lib/axios";
import { Button } from "../ui/button";
import { Input } from "../ui/input";

const requestTypes = ["email", "domain", "vpn_remote_access", "internet_access", "data_copy", "network_access", "computer_move_installation", "it_support_ticket"];
const roles = ["direct_manager", "information_security", "it_manager", "it_staff", "executive_management", "implementation", "execution"];

export default function WorkflowSettings({ notify }) {
  const [workflows, setWorkflows] = useState([]);
  const [requestType, setRequestType] = useState("vpn_remote_access");
  const [steps, setSteps] = useState([{ approver_role: "direct_manager", step_order: 1, is_mandatory: true, sla_hours: 8 }]);
  const [error, setError] = useState("");

  async function load() {
    try {
      const { data } = await api.get("/workflows");
      setWorkflows(data);
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    }
  }

  useEffect(() => {
    load();
  }, []);

  function updateStep(index, patch) {
    setSteps((current) => current.map((step, i) => i === index ? { ...step, ...patch } : step).map((step, i) => ({ ...step, step_order: i + 1 })));
  }

  function moveStep(index, direction) {
    setSteps((current) => {
      const next = [...current];
      const target = index + direction;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((step, i) => ({ ...step, step_order: i + 1 }));
    });
  }

  async function save(event) {
    event.preventDefault();
    try {
      await api.post("/workflows", { request_type: requestType, name: requestType, steps });
      notify("تم حفظ مسار الموافقات");
      await load();
    } catch (error) {
      const message = getErrorMessage(error);
      setError(message);
      notify(message, "error");
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={save} className="space-y-3 rounded-md border border-slate-200 p-4">
        <select value={requestType} onChange={(event) => setRequestType(event.target.value)} className="h-10 w-full rounded-md border border-slate-300 px-3 text-sm">
          {requestTypes.map((item) => <option key={item}>{item}</option>)}
        </select>
        {steps.map((step, index) => (
          <div key={index} className="grid gap-3 md:grid-cols-[80px_1fr_120px_120px_150px]">
            <Input type="number" value={step.step_order} onChange={(event) => updateStep(index, { step_order: Number(event.target.value) })} />
            <select value={step.approver_role} onChange={(event) => updateStep(index, { approver_role: event.target.value })} className="h-10 rounded-md border border-slate-300 px-3 text-sm">
              {roles.map((role) => <option key={role}>{role}</option>)}
            </select>
            <Input type="number" value={step.sla_hours} onChange={(event) => updateStep(index, { sla_hours: Number(event.target.value) })} />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={step.is_mandatory} onChange={(event) => updateStep(index, { is_mandatory: event.target.checked })} /> Mandatory</label>
            <div className="flex gap-2">
              <button type="button" onClick={() => moveStep(index, -1)} className="rounded-md border px-2 text-sm">Up</button>
              <button type="button" onClick={() => moveStep(index, 1)} className="rounded-md border px-2 text-sm">Down</button>
              <button type="button" onClick={() => setSteps((current) => current.filter((_, i) => i !== index))} className="rounded-md border border-red-200 px-2 text-sm text-red-700">Remove</button>
            </div>
          </div>
        ))}
        <div className="flex gap-3">
          <button type="button" onClick={() => setSteps((current) => [...current, { approver_role: "it_manager", step_order: current.length + 1, is_mandatory: true, sla_hours: 8 }])} className="h-10 rounded-md border px-4 text-sm font-semibold">Add Step</button>
          <Button type="submit">Save Flow</Button>
        </div>
      </form>
      {error && <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {workflows.map((workflow) => (
          <div key={workflow.id} className="rounded-md border p-4">
            <p className="font-semibold">{workflow.request_type}</p>
            <p className="mt-1 text-sm text-slate-500">{workflow.steps?.length ?? 0} steps</p>
          </div>
        ))}
      </div>
    </div>
  );
}
