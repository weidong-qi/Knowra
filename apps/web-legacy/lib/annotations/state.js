export const insertAnnotation = (items, annotation) => [annotation, ...items.filter((item) => item.id !== annotation.id)];
export const replaceAnnotation = (items, annotation) => items.map((item) => item.id === annotation.id ? annotation : item);
export const removeAnnotation = (items, id) => items.filter((item) => item.id !== id);
