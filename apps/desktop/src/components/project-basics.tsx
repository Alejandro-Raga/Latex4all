/**
 * What a new project is, set as it's made (each optional): its type, its
 * priority and its deadline, the same as can be set later.
 */
import { useState } from "react";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { DueButton, PriorityMenu } from "@/components/planner/task-parts";
import {
  newPlanText,
  PLAN_FILE,
  parsePlan,
  type Priority,
  serializePlan,
  setProjectDue,
  setProjectPriority,
} from "@/lib/plan/plan-file";
import { typeMenuOptions, writeProjectType } from "@/lib/project-meta";
import { join } from "@/lib/tauri/fs";
import { useProjectStore } from "@/stores/project-store";

export interface Basics {
  type: string | null;
  priority: Priority;
  due?: string;
}

export function useBasics(type: string | null = null) {
  return useState<Basics>({ type, priority: 0 });
}

/** Writes them into the new project's folder. */
export async function applyBasics(
  projectPath: string,
  name: string,
  basics: Basics,
) {
  if (basics.type) {
    await writeProjectType(projectPath, basics.type).catch(() => {});
  }
  if (basics.priority || basics.due) {
    let plan = parsePlan(newPlanText(name));
    plan = setProjectDue(plan, basics.due);
    plan = setProjectPriority(plan, basics.priority);
    await writeTextFile(
      await join(projectPath, PLAN_FILE),
      serializePlan(plan),
    ).catch(() => {});
  }
}

export function ProjectBasics({
  value,
  onChange,
}: {
  value: Basics;
  onChange: (b: Basics) => void;
}) {
  const types = useProjectStore((s) => s.projectTypes);
  const options = typeMenuOptions(Object.values(types));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <select
        value={value.type ?? ""}
        onChange={(e) => onChange({ ...value, type: e.target.value || null })}
        aria-label="Type"
        className="h-7 rounded-md border border-input bg-background px-1.5 text-xs"
      >
        <option value="">No type</option>
        {options.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
      <PriorityMenu
        priority={value.priority}
        onChange={(priority) => onChange({ ...value, priority })}
      />
      <DueButton
        label="Deadline"
        due={value.due}
        onChange={(due) => onChange({ ...value, due })}
      />
    </div>
  );
}
