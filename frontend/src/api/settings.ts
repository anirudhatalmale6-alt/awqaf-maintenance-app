import { customApi } from '@/lib/customApi';

export interface EnvVariable {
  key: string;
  value: string;
  description: string;
}

export interface EnvConfig {
  backend_vars: Record<string, EnvVariable>;
  frontend_vars: Record<string, EnvVariable>;
}

export interface EnvVariableUpdate {
  value: string;
}

export const settingsApi = {
  async getConfig(): Promise<EnvConfig> {
    const response = await customApi<EnvConfig>('/api/v1/admin/settings/', 'GET');
    return response.data;
  },

  async updateBackendConfig(key: string, value: string): Promise<{ message: string }> {
    const response = await customApi<{ message: string }>(`/api/v1/admin/settings/backend/${key}`, 'PUT', { value });
    return response.data;
  },

  async updateFrontendConfig(key: string, value: string): Promise<{ message: string }> {
    const response = await customApi<{ message: string }>(`/api/v1/admin/settings/frontend/${key}`, 'PUT', { value });
    return response.data;
  },

  async addBackendConfig(key: string, value: string): Promise<{ message: string }> {
    const response = await customApi<{ message: string }>(`/api/v1/admin/settings/backend/${key}`, 'POST', { value });
    return response.data;
  },

  async addFrontendConfig(key: string, value: string): Promise<{ message: string }> {
    const response = await customApi<{ message: string }>(`/api/v1/admin/settings/frontend/${key}`, 'POST', { value });
    return response.data;
  },

  async deleteBackendConfig(key: string): Promise<{ message: string }> {
    const response = await customApi<{ message: string }>(`/api/v1/admin/settings/backend/${key}`, 'DELETE');
    return response.data;
  },

  async deleteFrontendConfig(key: string): Promise<{ message: string }> {
    const response = await customApi<{ message: string }>(`/api/v1/admin/settings/frontend/${key}`, 'DELETE');
    return response.data;
  },
};
