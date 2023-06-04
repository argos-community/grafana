import { css } from '@emotion/css';
import React, { useMemo } from 'react';

import { GrafanaTheme2 } from '@grafana/data/src';
import { InlineLabel, SegmentSection, useStyles2 } from '@grafana/ui/src';

import { useUniqueId } from '../../../../../../../../../hooks/useUniqueId';
import InfluxDatasource from '../../../../../../datasource';
import {
  getAllMeasurementsForTags,
  getFieldKeysForMeasurement,
  getTagKeysForMeasurementAndTags,
  getTagValues,
} from '../../../../../../influxql_metadata_migrated';
import {
  addNewGroupByPart,
  addNewSelectPart,
  changeGroupByPart,
  changeSelectPart,
  normalizeQuery,
  removeGroupByPart,
  removeSelectPart,
} from '../../../../../../queryUtils';
import { InfluxQuery, InfluxQueryTag } from '../../../../../../types';
import { DEFAULT_RESULT_FORMAT } from '../../../../constants';
import { useRetentionPolicies } from '../../hooks/useRetentionPolicies';
import { filterTags } from '../../utils/filterTags';
import { withTemplateVariableOptions } from '../../utils/withTemplateVariableOptions';
import { wrapPure, wrapRegex } from '../../utils/wrapper';
import { FormatAsSection } from '../shared/FormatAsSection';
import { FromSection } from '../shared/FromSection';
import { InputSection } from '../shared/InputSection';
import { OrderByTimeSection } from '../shared/OrderByTimeSection';
import { PartListSection } from '../shared/PartListSection';
import { TagsSection } from '../shared/TagsSection';
import { getNewGroupByPartOptions, getNewSelectPartOptions, makePartList } from '../shared/partListUtils';

type Props = {
  query: InfluxQuery;
  onChange: (query: InfluxQuery) => void;
  onRunQuery: () => void;
  datasource: InfluxDatasource;
};

export const VisualInfluxQLMigratedEditor = (props: Props) => {
  const uniqueId = useUniqueId();
  const formatAsId = `influxdb-qe-format-as-${uniqueId}`;
  const orderByTimeId = `influxdb-qe-order-by${uniqueId}`;

  const styles = useStyles2(getStyles);
  const { datasource, onRunQuery, onChange } = props;
  const query = normalizeQuery(props.query);
  const { measurement, policy } = query;
  const { retentionPolicies } = useRetentionPolicies(datasource);

  const allTagKeys = useMemo(async () => {
    const tagKeys = (await getTagKeysForMeasurementAndTags(datasource, [], measurement, policy)).map(
      (tag) => `${tag}::tag`
    );

    const fieldKeys = (await getFieldKeysForMeasurement(datasource, measurement || '', policy)).map(
      (field) => `${field}::field`
    );

    return new Set([...tagKeys, ...fieldKeys]);
  }, [measurement, policy, datasource]);

  const selectLists = useMemo(() => {
    const dynamicSelectPartOptions = new Map([
      [
        'field_0',
        () => {
          return measurement !== undefined
            ? getFieldKeysForMeasurement(datasource, measurement, policy)
            : Promise.resolve([]);
        },
      ],
    ]);
    return (query.select ?? []).map((sel) => makePartList(sel, dynamicSelectPartOptions));
  }, [measurement, policy, query.select, datasource]);

  // the following function is not complicated enough to memoize, but it's result
  // is used in both memoized and un-memoized parts, so we have no choice
  const getTagKeys = useMemo(
    () => async () => {
      const selectedTagKeys = new Set(query.tags?.map((tag) => tag.key));

      return [...(await allTagKeys)].filter((tagKey) => !selectedTagKeys.has(tagKey));
    },
    [query.tags, allTagKeys]
  );

  const groupByList = useMemo(() => {
    const dynamicGroupByPartOptions = new Map([['tag_0', getTagKeys]]);

    return makePartList(query.groupBy ?? [], dynamicGroupByPartOptions);
  }, [getTagKeys, query.groupBy]);

  const onAppliedChange = (newQuery: InfluxQuery) => {
    onChange(newQuery);
    onRunQuery();
  };
  const handleFromSectionChange = (policy?: string, measurement?: string) => {
    onAppliedChange({
      ...query,
      policy,
      measurement,
    });
  };

  const handleTagsSectionChange = (tags: InfluxQueryTag[]) => {
    // we set empty-arrays to undefined
    onAppliedChange({
      ...query,
      tags: tags.length === 0 ? undefined : tags,
    });
  };

  return (
    <div>
      <SegmentSection label="FROM" fill={true}>
        <FromSection
          policy={query.policy ?? retentionPolicies[0]}
          measurement={query.measurement}
          getPolicyOptions={() => withTemplateVariableOptions(Promise.resolve(retentionPolicies), wrapPure)}
          getMeasurementOptions={(filter) =>
            withTemplateVariableOptions(
              allTagKeys.then((keys) =>
                getAllMeasurementsForTags(
                  datasource,
                  filterTags(query.tags ?? [], keys),
                  filter === '' ? undefined : filter
                )
              ),
              wrapRegex,
              filter
            )
          }
          onChange={handleFromSectionChange}
        />
        <InlineLabel width="auto" className={styles.inlineLabel}>
          WHERE
        </InlineLabel>
        <TagsSection
          tags={query.tags ?? []}
          onChange={handleTagsSectionChange}
          getTagKeyOptions={getTagKeys}
          getTagValueOptions={(key) =>
            withTemplateVariableOptions(
              allTagKeys.then((keys) => getTagValues(datasource, filterTags(query.tags ?? [], keys), key)),
              wrapRegex
            )
          }
        />
      </SegmentSection>
      {selectLists.map((sel, index) => (
        <SegmentSection key={index} label={index === 0 ? 'SELECT' : ''} fill={true}>
          <PartListSection
            parts={sel}
            getNewPartOptions={() => Promise.resolve(getNewSelectPartOptions())}
            onChange={(partIndex, newParams) => {
              const newQuery = changeSelectPart(query, index, partIndex, newParams);
              onAppliedChange(newQuery);
            }}
            onAddNewPart={(type) => {
              onAppliedChange(addNewSelectPart(query, type, index));
            }}
            onRemovePart={(partIndex) => {
              onAppliedChange(removeSelectPart(query, partIndex, index));
            }}
          />
        </SegmentSection>
      ))}
      <SegmentSection label="GROUP BY" fill={true}>
        <PartListSection
          parts={groupByList}
          getNewPartOptions={() => getNewGroupByPartOptions(query, getTagKeys)}
          onChange={(partIndex, newParams) => {
            const newQuery = changeGroupByPart(query, partIndex, newParams);
            onAppliedChange(newQuery);
          }}
          onAddNewPart={(type) => {
            onAppliedChange(addNewGroupByPart(query, type));
          }}
          onRemovePart={(partIndex) => {
            onAppliedChange(removeGroupByPart(query, partIndex));
          }}
        />
      </SegmentSection>
      <SegmentSection label="TIMEZONE" fill={true}>
        <InputSection
          placeholder="(optional)"
          value={query.tz}
          onChange={(tz) => {
            onAppliedChange({ ...query, tz });
          }}
        />
        <InlineLabel htmlFor={orderByTimeId} width="auto" className={styles.inlineLabel}>
          ORDER BY TIME
        </InlineLabel>
        <OrderByTimeSection
          inputId={orderByTimeId}
          value={query.orderByTime === 'DESC' ? 'DESC' : 'ASC' /* FIXME: make this shared with influx_query_model */}
          onChange={(v) => {
            onAppliedChange({ ...query, orderByTime: v });
          }}
        />
      </SegmentSection>
      {/* query.fill is ignored in the query-editor, and it is deleted whenever
          query-editor changes. the influx_query_model still handles it, but the new
          approach seem to be to handle "fill" inside query.groupBy. so, if you
          have a panel where in the json you have query.fill, it will be applied,
          as long as you do not edit that query. */}
      <SegmentSection label="LIMIT" fill={true}>
        <InputSection
          placeholder="(optional)"
          value={query.limit?.toString()}
          onChange={(limit) => {
            onAppliedChange({ ...query, limit });
          }}
        />
        <InlineLabel width="auto" className={styles.inlineLabel}>
          SLIMIT
        </InlineLabel>
        <InputSection
          placeholder="(optional)"
          value={query.slimit?.toString()}
          onChange={(slimit) => {
            onAppliedChange({ ...query, slimit });
          }}
        />
      </SegmentSection>
      <SegmentSection htmlFor={formatAsId} label="FORMAT AS" fill={true}>
        <FormatAsSection
          inputId={formatAsId}
          format={query.resultFormat ?? DEFAULT_RESULT_FORMAT}
          onChange={(format) => {
            onAppliedChange({ ...query, resultFormat: format });
          }}
        />
        {query.resultFormat !== 'table' && (
          <>
            <InlineLabel width="auto" className={styles.inlineLabel}>
              ALIAS
            </InlineLabel>
            <InputSection
              isWide
              placeholder="Naming pattern"
              value={query.alias}
              onChange={(alias) => {
                onAppliedChange({ ...query, alias });
              }}
            />
          </>
        )}
      </SegmentSection>
    </div>
  );
};

function getStyles(theme: GrafanaTheme2) {
  return {
    inlineLabel: css`
      color: ${theme.colors.primary.text};
    `,
  };
}
