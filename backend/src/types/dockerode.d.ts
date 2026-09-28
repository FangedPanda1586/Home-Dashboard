declare module "dockerode" {
  type DockerOptions = { socketPath?: string };

  type DockerPort = {
    IP?: string;
    PrivatePort: number;
    PublicPort?: number;
    Type: string;
  };

  type DockerMount = {
    Type?: string;
    Name?: string;
    Source?: string;
    Destination?: string;
    Driver?: string;
    Mode?: string;
    RW?: boolean;
    Propagation?: string;
  };

  type DockerContainerSummary = {
    Id: string;
    Names: string[];
    Image: string;
    ImageID?: string;
    Command?: string;
    Created?: number;
    Ports?: DockerPort[];
    Mounts?: DockerMount[];
    State: string;
    Status: string;
    Labels?: Record<string, string>;
  };

  type ContainerStats = {
    cpu_stats?: {
      online_cpus?: number;
      system_cpu_usage?: number;
      cpu_usage?: {
        total_usage?: number;
        percpu_usage?: number[];
      };
    };
    precpu_stats?: {
      system_cpu_usage?: number;
      cpu_usage?: {
        total_usage?: number;
      };
    };
    memory_stats?: {
      usage?: number;
      limit?: number;
      stats?: {
        cache?: number;
        inactive_file?: number;
      };
    };
  };

  class Container {
    inspect(): Promise<{ Image?: string; Config?: { Image?: string } }>;
    stats(options?: { stream?: boolean }): Promise<ContainerStats>;
    start(options?: Record<string, unknown>): Promise<unknown>;
    stop(options?: { t?: number }): Promise<unknown>;
    restart(options?: { t?: number }): Promise<unknown>;
    logs(options?: { stdout?: boolean; stderr?: boolean; tail?: number; timestamps?: boolean }): Promise<Buffer | string>;
  }

  class Image {
    inspect(): Promise<{ Id?: string; RepoDigests?: string[] }>;
  }

  type PullStream = NodeJS.ReadableStream;

  export default class Docker {
    constructor(options?: DockerOptions);
    listContainers(options?: { all?: boolean }): Promise<DockerContainerSummary[]>;
    getContainer(id: string): Container;
    getImage(name: string): Image;
    pull(name: string): Promise<PullStream>;
    ping(): Promise<unknown>;
    modem: {
      followProgress(
        stream: PullStream,
        callback: (error: Error | null, output?: unknown[]) => void,
      ): void;
    };
  }
}
