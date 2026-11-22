/**
 * Read policies for module attachments. Imported by the download route so every module's
 * rule is registered before a file is served. Writes happen only inside module services.
 */
import { registerAttachmentPolicy } from "./attachments";
import { assertCanViewWorkOrder, assertCanViewRequest } from "./maintenance";
import { assertCanViewAnswer } from "./checklists";
import { assertCanViewAssignment, assertCanViewInspection } from "./housekeeping";
import { ForbiddenError } from "@/lib/errors";

const deny = async () => { throw new ForbiddenError(); };
registerAttachmentPolicy("work_order", { read: async (tx, a, id) => { await assertCanViewWorkOrder(tx, a, id); }, write: deny });
registerAttachmentPolicy("maintenance_request", { read: async (tx, a, id) => { await assertCanViewRequest(tx, a, id); }, write: deny });
registerAttachmentPolicy("checklist_answer", { read: assertCanViewAnswer, write: deny });
registerAttachmentPolicy("hk_assignment", { read: assertCanViewAssignment, write: deny });
registerAttachmentPolicy("hk_inspection", { read: assertCanViewInspection, write: deny });

export const POLICIES_REGISTERED = true;
