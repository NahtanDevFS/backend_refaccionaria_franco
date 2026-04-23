// types/venta.types.ts

export enum CanalVenta {
  MOSTRADOR = "mostrador",
  DOMICILIO = "domicilio",
}

export enum EstadoVenta {
  PENDIENTE_PAGO = "pendiente_pago",
  PAGADA = "pagada",
  EN_PREPARACION = "en_preparacion",
  EN_REPARTO = "en_reparto",
  ENTREGADA = "entregada",
  CANCELADA = "cancelada",
}
