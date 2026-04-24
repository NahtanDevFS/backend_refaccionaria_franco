// dtos/MetaDTO.ts
export interface AsignarMetaDTO {
  id_empleado: number;
  anio: number;
  mes: number;
  monto_meta: number;
  comision_base_pct?: number; // default 2.0
  comision_excedente_pct?: number; // default 4.0
}
