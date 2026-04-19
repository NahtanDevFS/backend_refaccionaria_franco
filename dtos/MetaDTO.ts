// dtos/MetaDTO.ts
// ── PUNTO 8: comision_base_pct y comision_excedente_pct siguen existiendo
//    en el DTO como parámetros de entrada. El MetaService los usa para
//    buscar (o crear) el esquema_comision correspondiente y guardar
//    id_esquema en meta_venta. La app no necesita saber nada de id_esquema.
export interface AsignarMetaDTO {
  id_empleado: number;
  anio: number;
  mes: number;
  monto_meta: number;
  comision_base_pct?: number; // default 2.0 — se resuelve a esquema en servicio
  comision_excedente_pct?: number; // default 4.0 — idem
}
