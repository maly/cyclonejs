import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial } from "three";
import type { PlanIssue } from "../sim/terrainTypes.ts";
import { heightAt, type World } from "../sim/world.ts";
import { ISSUE_COLOR } from "./palette.ts";

const postGeometry = new BoxGeometry(0.7, 4.5, 0.7);
postGeometry.translate(0, 2.25, 0);

export function buildIssueMesh(world: World, issues: PlanIssue[]): Group {
  const group = new Group();
  group.name = "issues";
  group.visible = false;
  for (const issue of issues) {
    const color = ISSUE_COLOR[issue.type] ?? ISSUE_COLOR.conflict;
    const mesh = new Mesh(
      postGeometry,
      new MeshBasicMaterial({ color: new Color(color[0], color[1], color[2]), toneMapped: false }),
    );
    const y = heightAt(world, issue.x + 0.5, issue.y + 0.5);
    mesh.position.set(issue.x + 0.5, y + 0.08, issue.y + 0.5);
    mesh.raycast = () => undefined;
    mesh.renderOrder = 4;
    group.add(mesh);
  }
  return group;
}
