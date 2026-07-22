{{- define "planipus.name" -}}
planipus
{{- end }}

{{- define "planipus.fullname" -}}
{{- printf "%s-planipus" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end }}

{{- define "planipus.labels" -}}
app.kubernetes.io/name: {{ include "planipus.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{- define "planipus.image" -}}
{{- if .Values.image.digest -}}
{{ printf "%s@%s" .Values.image.repository .Values.image.digest }}
{{- else -}}
{{ printf "%s:%s" .Values.image.repository .Values.image.tag }}
{{- end -}}
{{- end }}

{{- define "planipus.postgresqlImage" -}}
{{- if .Values.postgresql.image.digest -}}
{{ printf "%s@%s" .Values.postgresql.image.repository .Values.postgresql.image.digest }}
{{- else -}}
{{ printf "%s:%s" .Values.postgresql.image.repository .Values.postgresql.image.tag }}
{{- end -}}
{{- end }}
