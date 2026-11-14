"use client";

import { Box, Component, Heading, Image as ImageIcon, Link2, List, ListOrdered, Minus, MousePointerClick, PanelTop, Table2, TextCursorInput, Type } from "lucide-react";
import type { ElementIconName } from "@/lib/edit/names";

const ICONS = {
  box: Box,
  heading: Heading,
  text: Type,
  link: Link2,
  button: MousePointerClick,
  image: ImageIcon,
  field: TextCursorInput,
  list: List,
  "list-item": ListOrdered,
  section: PanelTop,
  divider: Minus,
  table: Table2,
  component: Component,
} as const;

// The picture of what an element is, beside its name.
export default function ElementIcon({ name, size = 12, className }: { name: ElementIconName; size?: number; className?: string }) {
  const Icon = ICONS[name];
  return <Icon size={size} className={className} aria-hidden />;
}
