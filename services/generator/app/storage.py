import os
from pathlib import Path
import re

import httpx

from .errors import GeneratorError

WORK_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
SUBJECT_OBJECT_PATH_PATTERN = re.compile(
    r"^uploads/[A-Za-z0-9_-]{8,64}/[A-Za-z0-9_-]{8,64}/subject\.png$"
)


class CloudBaseStorage:
    def __init__(self, api_base: str, api_key: str, client: httpx.Client | None = None):
        self.api_base = api_base.rstrip("/")
        self.api_key = api_key
        self.client = client

    @classmethod
    def from_environment(cls):
        env_id = os.getenv("TCB_ENV_ID") or os.getenv("CLOUDBASE_ENV_ID")
        api_key = (
            os.getenv("TCB_API_KEY")
            or os.getenv("CLOUDBASE_API_KEY")
            or os.getenv("CLOUDBASE_APIKEY")
        )
        if not env_id or not api_key:
            raise GeneratorError("NETWORK_ERROR")

        api_base = os.getenv("TCB_API_BASE")
        if not api_base:
            international = os.getenv("TCB_REGION", "mainland").lower() in {
                "intl",
                "international",
                "ap-singapore",
            }
            domain = "api.intl.tcloudbasegateway.com" if international else "api.tcloudbasegateway.com"
            api_base = f"https://{env_id}.{domain}"
        return cls(api_base, api_key)

    def upload_outputs(
        self,
        gif_path: Path,
        cover_path: Path,
        work_id: str,
        *,
        subject_path: Path | None = None,
        reused_subject_file_id: str | None = None,
    ) -> tuple[str, str] | tuple[str, str, str]:
        if not WORK_ID_PATTERN.fullmatch(work_id):
            raise GeneratorError("INVALID_INPUT")
        if reused_subject_file_id and not reused_subject_file_id.startswith("cloud://"):
            raise GeneratorError("INVALID_INPUT")

        own_client = self.client is None
        client = self.client or httpx.Client(timeout=httpx.Timeout(30, read=120))
        uploaded_ids: list[str] = []
        try:
            outputs = [
                (gif_path, f"works/{work_id}/result.gif", "image/gif"),
                (cover_path, f"works/{work_id}/cover.jpg", "image/jpeg"),
            ]
            if subject_path is not None and reused_subject_file_id is None:
                outputs.append((subject_path, f"works/{work_id}/subject.png", "image/png"))
            object_ids = []
            for file_path, object_id, mime_type in outputs:
                object_ids.append(
                    self._upload_one(client, file_path, object_id, mime_type)
                )
                uploaded_ids.append(object_ids[-1])
            if subject_path is None and reused_subject_file_id is None:
                return object_ids[0], object_ids[1]
            subject_id = reused_subject_file_id or object_ids[2]
            return object_ids[0], object_ids[1], subject_id
        except GeneratorError:
            self._delete_uploaded(client, uploaded_ids)
            raise
        except Exception:
            self._delete_uploaded(client, uploaded_ids)
            raise GeneratorError("NETWORK_ERROR") from None
        finally:
            if own_client:
                client.close()

    def upload_subject(self, subject_path: Path, object_path: str) -> str:
        if SUBJECT_OBJECT_PATH_PATTERN.fullmatch(object_path) is None:
            raise GeneratorError("INVALID_INPUT")

        own_client = self.client is None
        client = self.client or httpx.Client(timeout=httpx.Timeout(30, read=120))
        try:
            file_id = self._upload_one(client, subject_path, object_path, "image/png")
            if not file_id.startswith("cloud://"):
                self._delete_uploaded(client, [file_id])
                raise GeneratorError("NETWORK_ERROR")
            return file_id
        except GeneratorError:
            raise
        except Exception:
            raise GeneratorError("NETWORK_ERROR") from None
        finally:
            if own_client:
                client.close()

    def _upload_one(self, client: httpx.Client, file_path: Path, object_id: str, mime_type: str) -> str:
        headers = {"Authorization": f"Bearer {self.api_key}"}
        response = client.post(
            f"{self.api_base}/v1/storages/get-objects-upload-info",
            headers=headers,
            json=[{"objectId": object_id}],
        )
        response.raise_for_status()
        payload = response.json()
        if isinstance(payload, dict):
            payload = payload.get("data", payload.get("result", payload))
        info = payload[0] if isinstance(payload, list) and payload else payload
        if not isinstance(info, dict):
            raise GeneratorError("NETWORK_ERROR")

        upload_url = info.get("uploadUrl")
        cloud_object_id = info.get("cloudObjectId")
        authorization = info.get("authorization")
        security_token = info.get("token")
        file_id = info.get("cloudObjectMeta")
        if not all((upload_url, cloud_object_id, authorization, security_token, file_id)):
            raise GeneratorError("NETWORK_ERROR")
        if not upload_url.startswith("https://"):
            raise GeneratorError("NETWORK_ERROR")

        upload_headers = {
            "Authorization": authorization,
            "X-Cos-Security-Token": security_token,
            "X-Cos-Meta-Fileid": file_id,
            "Content-Type": mime_type,
        }
        try:
            with file_path.open("rb") as file_handle:
                uploaded = client.put(upload_url, headers=upload_headers, content=file_handle)
            uploaded.raise_for_status()
        except Exception:
            self._delete_uploaded(client, [cloud_object_id])
            raise
        return cloud_object_id

    def _delete_uploaded(self, client: httpx.Client, cloud_object_ids: list[str]) -> None:
        if not cloud_object_ids:
            return
        try:
            response = client.post(
                f"{self.api_base}/v1/storages/delete-objects",
                headers={"Authorization": f"Bearer {self.api_key}"},
                json=[{"cloudObjectId": object_id} for object_id in cloud_object_ids],
            )
            response.raise_for_status()
        except Exception:
            pass
