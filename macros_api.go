package main

import (
	"encoding/json"
	"errors"
	"sort"
	"time"

	"daimon/internal/storage"
	"gorm.io/gorm"
)

type MacroDataItemDTO struct {
	ID    string `json:"id"`
	Key   string `json:"key"`
	Value string `json:"value"`
	Order int    `json:"order"`
}

type MacroParamDTO struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Prompt string `json:"prompt"`
	Order  int    `json:"order"`
}

type MacroDTO struct {
	ID        string             `json:"id"`
	Name      string             `json:"name"`
	Tags      []string           `json:"tags"`
	Script    string             `json:"script"`
	DataItems []MacroDataItemDTO `json:"dataItems"`
	Params    []MacroParamDTO    `json:"params"`
	CreatedAt string             `json:"createdAt"`
	UpdatedAt string             `json:"updatedAt"`
}

type UpsertMacroRequest struct {
	ID        string             `json:"id,omitempty"`
	Name      string             `json:"name"`
	Tags      []string           `json:"tags"`
	Script    string             `json:"script"`
	DataItems []MacroDataItemDTO `json:"dataItems"`
	Params    []MacroParamDTO    `json:"params"`
}

type MacroBindingDTO struct {
	ID         string `json:"id"`
	ProfileID  string `json:"profileId"`
	MacroID    string `json:"macroId"`
	IsFavorite bool   `json:"isFavorite"`
	Enabled    bool   `json:"enabled"`
	UpdatedAt  string `json:"updatedAt"`
}

func (a *App) ListMacros() ([]MacroDTO, error) {
	if a.db == nil || a.db.DB == nil {
		return nil, errors.New("app not ready")
	}
	var macros []storage.Macro
	if err := a.db.DB.Order("updated_at desc").Find(&macros).Error; err != nil {
		return nil, err
	}

	ids := make([]string, 0, len(macros))
	for _, m := range macros {
		ids = append(ids, m.ID)
	}

	dataByMacro := map[string][]storage.MacroDataItem{}
	paramByMacro := map[string][]storage.MacroParam{}
	if len(ids) > 0 {
		var dataItems []storage.MacroDataItem
		if err := a.db.DB.Find(&dataItems, "macro_id IN ?", ids).Error; err != nil {
			return nil, err
		}
		for _, d := range dataItems {
			dataByMacro[d.MacroID] = append(dataByMacro[d.MacroID], d)
		}
		var params []storage.MacroParam
		if err := a.db.DB.Find(&params, "macro_id IN ?", ids).Error; err != nil {
			return nil, err
		}
		for _, p := range params {
			paramByMacro[p.MacroID] = append(paramByMacro[p.MacroID], p)
		}
	}

	out := make([]MacroDTO, 0, len(macros))
	for _, m := range macros {
		var tags []string
		_ = json.Unmarshal([]byte(m.TagsJSON), &tags)
		items := dataByMacro[m.ID]
		params := paramByMacro[m.ID]
		sort.Slice(items, func(i, j int) bool { return items[i].Order < items[j].Order })
		sort.Slice(params, func(i, j int) bool { return params[i].Order < params[j].Order })

		dto := MacroDTO{
			ID:        m.ID,
			Name:      m.Name,
			Tags:      tags,
			Script:    m.Script,
			DataItems: make([]MacroDataItemDTO, 0, len(items)),
			Params:    make([]MacroParamDTO, 0, len(params)),
			CreatedAt: m.CreatedAt.Format(time.RFC3339Nano),
			UpdatedAt: m.UpdatedAt.Format(time.RFC3339Nano),
		}
		for _, it := range items {
			dto.DataItems = append(dto.DataItems, MacroDataItemDTO{
				ID:    it.ID,
				Key:   it.Key,
				Value: it.Value,
				Order: it.Order,
			})
		}
		for _, p := range params {
			dto.Params = append(dto.Params, MacroParamDTO{
				ID:     p.ID,
				Name:   p.Name,
				Prompt: p.Prompt,
				Order:  p.Order,
			})
		}
		out = append(out, dto)
	}
	return out, nil
}

func (a *App) UpsertMacro(req UpsertMacroRequest) (MacroDTO, error) {
	if a.db == nil || a.db.DB == nil {
		return MacroDTO{}, errors.New("app not ready")
	}
	if req.Name == "" {
		return MacroDTO{}, errors.New("name required")
	}

	tagsJSON, _ := json.Marshal(req.Tags)

	var out MacroDTO
	err := a.db.DB.Transaction(func(tx *gorm.DB) error {
		var m storage.Macro
		if req.ID != "" {
			if err := tx.First(&m, "id = ?", req.ID).Error; err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				return err
			}
		}
		m.ID = req.ID
		m.Name = req.Name
		m.TagsJSON = string(tagsJSON)
		m.Script = req.Script
		if err := tx.Save(&m).Error; err != nil {
			return err
		}

		if err := tx.Delete(&storage.MacroDataItem{}, "macro_id = ?", m.ID).Error; err != nil {
			return err
		}
		if err := tx.Delete(&storage.MacroParam{}, "macro_id = ?", m.ID).Error; err != nil {
			return err
		}

		for i, d := range req.DataItems {
			it := storage.MacroDataItem{
				MacroID: m.ID,
				Key:     d.Key,
				Value:   d.Value,
				Order:   i,
			}
			if err := tx.Create(&it).Error; err != nil {
				return err
			}
		}
		for i, p := range req.Params {
			it := storage.MacroParam{
				MacroID: m.ID,
				Name:    p.Name,
				Prompt:  p.Prompt,
				Order:   i,
			}
			if err := tx.Create(&it).Error; err != nil {
				return err
			}
		}

		out = MacroDTO{
			ID:        m.ID,
			Name:      m.Name,
			Tags:      req.Tags,
			Script:    m.Script,
			DataItems: req.DataItems,
			Params:    req.Params,
			CreatedAt: m.CreatedAt.Format(time.RFC3339Nano),
			UpdatedAt: m.UpdatedAt.Format(time.RFC3339Nano),
		}
		return nil
	})
	if err != nil {
		return MacroDTO{}, err
	}
	return out, nil
}

func (a *App) DeleteMacro(id string) error {
	if a.db == nil || a.db.DB == nil {
		return errors.New("app not ready")
	}
	if id == "" {
		return errors.New("id required")
	}
	return a.db.DB.Transaction(func(tx *gorm.DB) error {
		if err := tx.Delete(&storage.MacroDataItem{}, "macro_id = ?", id).Error; err != nil {
			return err
		}
		if err := tx.Delete(&storage.MacroParam{}, "macro_id = ?", id).Error; err != nil {
			return err
		}
		if err := tx.Delete(&storage.MacroBinding{}, "macro_id = ?", id).Error; err != nil {
			return err
		}
		return tx.Delete(&storage.Macro{}, "id = ?", id).Error
	})
}

func (a *App) ListMacroBindings(profileId string) ([]MacroBindingDTO, error) {
	if a.db == nil || a.db.DB == nil {
		return nil, errors.New("app not ready")
	}
	if profileId == "" {
		return nil, errors.New("profileId required")
	}
	var rows []storage.MacroBinding
	if err := a.db.DB.Find(&rows, "profile_id = ?", profileId).Error; err != nil {
		return nil, err
	}
	out := make([]MacroBindingDTO, 0, len(rows))
	for _, r := range rows {
		out = append(out, MacroBindingDTO{
			ID:         r.ID,
			ProfileID:  r.ProfileID,
			MacroID:    r.MacroID,
			IsFavorite: r.IsFavorite,
			Enabled:    r.Enabled,
			UpdatedAt:  r.UpdatedAt.Format(time.RFC3339Nano),
		})
	}
	return out, nil
}

func (a *App) SetMacroFavorite(profileId string, macroId string, fav bool) (MacroBindingDTO, error) {
	if a.db == nil || a.db.DB == nil {
		return MacroBindingDTO{}, errors.New("app not ready")
	}
	if profileId == "" || macroId == "" {
		return MacroBindingDTO{}, errors.New("profileId and macroId required")
	}
	var b storage.MacroBinding
	if err := a.db.DB.First(&b, "profile_id = ? AND macro_id = ?", profileId, macroId).Error; err != nil {
		if !errors.Is(err, gorm.ErrRecordNotFound) {
			return MacroBindingDTO{}, err
		}
		b = storage.MacroBinding{
			ProfileID:  profileId,
			MacroID:    macroId,
			IsFavorite: fav,
			Enabled:    true,
		}
		if err := a.db.DB.Create(&b).Error; err != nil {
			return MacroBindingDTO{}, err
		}
	} else {
		b.IsFavorite = fav
		if err := a.db.DB.Save(&b).Error; err != nil {
			return MacroBindingDTO{}, err
		}
	}
	return MacroBindingDTO{
		ID:         b.ID,
		ProfileID:  b.ProfileID,
		MacroID:    b.MacroID,
		IsFavorite: b.IsFavorite,
		Enabled:    b.Enabled,
		UpdatedAt:  b.UpdatedAt.Format(time.RFC3339Nano),
	}, nil
}
