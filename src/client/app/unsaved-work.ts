import { useEffect } from "react";

const unsavedWork = new Set<string>();

export function setUnsavedWork(id: string, dirty: boolean): void {
  if (dirty) unsavedWork.add(id);
  else unsavedWork.delete(id);
}

export function hasUnsavedWork(): boolean {
  return unsavedWork.size > 0;
}

export function useUnsavedWork(id: string, dirty: boolean): void {
  useEffect(() => {
    setUnsavedWork(id, dirty);
    return () => setUnsavedWork(id, false);
  }, [dirty, id]);
}
