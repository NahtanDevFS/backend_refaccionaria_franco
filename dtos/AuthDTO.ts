// dtos/AuthDTO.ts
export interface LoginDTO {
  username: string;
  password: string;
}

export interface RegistrarUsuarioDTO {
  id_empleado: number;
  id_rol: number;
  username: string;
  password: string;
}
