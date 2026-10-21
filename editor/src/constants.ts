// Interaction constants. Screen distances are CSS pixels; design distances are mm.

export const SNAP_PX = 8;
export const RULER_PX = 22;
/** Arrow-key nudge (Shift x10). */
export const NUDGE_MM = 0.5;
export const NUDGE_BIG_FACTOR = 10;
/** [ and ] change a node's width by this. */
export const NODE_WIDTH_STEP_MM = 0.1;
/** A press becomes a drag after moving this far. */
export const DRAG_THRESHOLD_PX = 4;
export const NODE_PICK_PX = 8;
export const OBJECT_PICK_PX = 6;
export const DOUBLE_CLICK_MS = 400;
export const HANDLE_PICK_PX = 7;
/** The rotate handle sits this far above the selection box. */
export const ROTATE_HANDLE_PX = 24;
export const HANDLE_PADDING_PX = 8;
export const MOVE_HANDLE_RADIUS_PX = 15;
export const PASTE_OFFSET_MM = 2;
export const MAX_SKEW_DEG = 70;
/** Delay before commitSoon commits (property fields being typed into). */
export const COMMIT_SOON_MS = 300;
/** SimStitch draws thread this thick. */
export const SIM_THREAD_MM = 0.4;
