// dtos/MetaDTO.ts
export interface AsignarMetaDTO {
  id_empleado: number; // El vendedor
  anio: number;
  mes: number;
  monto_meta: number;
  comision_base_pct?: number;
  comision_excedente_pct?: number;
}
